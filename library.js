'use strict';

// Filter download log entries by uid, from/to timestamps, binary types
function FilterDownloadData(sourceData, uid, fromTS, toTS, binaryType) {
	const retVal = [];
	for (const i in sourceData) {
		if (sourceData.hasOwnProperty(i)) {
			const entry = sourceData[i];
			if (uid > 0) {
				if (fromTS > 0.0) {
					if (toTS > 0.0) {
						if (binaryType !== '') {
							if (entry.binarytype === binaryType &&
								entry.timestamp >= fromTS &&
								entry.timestamp <= toTS &&
								entry.uid === uid) retVal.push(entry);
						} else if (entry.timestamp >= fromTS &&
								entry.timestamp <= toTS &&
								entry.uid === uid) retVal.push(entry);
					} else if (binaryType !== '') {
						if (entry.binarytype === binaryType &&
								entry.timestamp >= fromTS &&
								entry.uid === uid) retVal.push(entry);
					} else if (entry.timestamp >= fromTS &&
								entry.uid === uid) retVal.push(entry);
				} else if (binaryType !== '') {
					if (entry.binarytype === binaryType &&
							entry.uid === uid) retVal.push(entry);
				} else if (entry.uid === uid) retVal.push(entry);
			} else if (fromTS > 0.0) {
				if (toTS > 0.0) {
					if (binaryType !== '') {
						if (entry.binarytype === binaryType &&
								entry.timestamp >= fromTS &&
								entry.timestamp <= toTS) retVal.push(entry);
					} else if (entry.timestamp >= fromTS &&
								entry.timestamp <= toTS) retVal.push(entry);
				} else if (binaryType !== '') {
					if (entry.binarytype === binaryType &&
								entry.timestamp >= fromTS) retVal.push(entry);
				} else if (entry.timestamp >= fromTS) retVal.push(entry);
			} else if (binaryType !== '') {
				if (entry.binarytype === binaryType) retVal.push(entry);
			} else {
				retVal.push(entry);
			}
		}
	}
	return retVal;
}

function LogDownloadData(db, uid, binaryFile, binaryLocation, binaryType, timestamp, binaryDownloadKey, nextDL, nextMaxonBinaryDownloadField) {
	// prepare data blob for log download request
	var data = {
		uid: uid,
		filename: binaryFile,
		binarylocation: binaryLocation,
		binarytype: binaryType,
		timestamp: timestamp,
	};

	// write data blob to DB and increment binary download counter
	db.setObject(binaryDownloadKey + ':' + String(nextDL), data);
	db.incrObjectField('global', nextMaxonBinaryDownloadField);
}

// Validate Date object
function isValidDate(d) {
	return d instanceof Date && !isNaN(d);
}

(function (MaxonBinary) {
	const fs = module.require('fs');
	const user = require.main.require('./src/user');
	// const groups = require.main.require('./src/groups');
	const db = require.main.require('./src/database');

	const azureStorage = require('azure-storage');

	const nconf = module.parent.require('nconf');
	const winston = module.parent.require('winston');

	// activate debug output
	const debugOutput = false;

	const constants = Object.freeze({
		upload_fullpath: nconf.get('upload_path'),
		binaryLocations: nconf.get('maxon_binary:binary_locations'),
		azureCredentials: nconf.get('maxon_binary:azure_credentials'),
		rateMBs: parseFloat(nconf.get('maxon_binary:rateMBs')),
	});
	// check the contants object for contain data
	// let configOk = false;
	if (!constants.upload_fullpath) {
		winston.error('[maxonBinary] Upload full path not set.');
	} else if (!constants.binaryLocations) {
		winston.error('[maxonBinary] Binary locations not set.');
	} else if (!constants.azureCredentials) {
		winston.error('[maxonBinary] Azure Storage Blob credentials not set.');
	} else if (!constants.rateMBs) {
		winston.error('[maxonBinary] Download rate threshold not set.');
	} else {
		// configOk = true;
		winston.info('[maxonBinary] Config is OK');
	}

	if (debugOutput) {
		winston.verbose('[maxonBinary] Configuration');
		console.log(constants);
	}

	// set upload_route given the upload_fullpath
	const upload_route = constants.upload_fullpath.substr(constants.upload_fullpath.lastIndexOf('/'));

	// DB counter for Maxon Binary downloads
	const nextMaxonBinaryDownloadField = 'nextMaxonBinaryDownload';
	// DB primary key for Maxon Binary entries
	const binaryDownloadKey = 'maxonbinary-download';

	// Method responsible to check user authentication and deliver Maxon binaries based on actual location
	// Method responsible to re-route non authenticated user to landing
	MaxonBinary.routesOnLoad = function (data, callback) {
		const app = data.app;
		const middleware = data.middleware;

		// re-route non authenticated users to landing
		app.get('/', function (req, res) {
			// check the user to be logged in
			if (req.loggedIn) res.redirect('/categories');
			else res.redirect('/landing');
		});

		app.get('/api' + upload_route + '/:type/:file(*?)', middleware.authenticate, middleware.validateAuth, function (req, res, callback) {
			const binaryType = req.params.type; // TODO specify also files
			const binaryFile = req.params.file;
			// check the user to be logged in
			if (req.loggedIn) {
				const uid = req.user.uid;

				// check passed type is among supported binary types
				if (!Object.keys(constants.binaryLocations).includes(binaryType)) {
					winston.error('[maxonBinary] Binary type [' + binaryType + '] not supported.');
					callback(new Error('Unexpected error. Please contact Backstage Community administrator.'));
				}

				// retrieve next download value retrieved from DB
				db.getObjectField('global', nextMaxonBinaryDownloadField, function (err, nextDLValue) {
					if (err) {
						return callback(err);
					}

					// check retrieved value from DB and if invalid initialize field
					let nextDL = 1;
					//
					if (!Object.is(nextDLValue, null)) {
						nextDL = nextDLValue;
					} else {
						db.setObjectField('global', nextMaxonBinaryDownloadField, nextDL);
					}

					// log the download start request
					if (debugOutput) {
						winston.verbose('[maxonBinary] User (' + uid + ') has requested ' + binaryFile + ' [' + binaryType + ']');
					}

					// retrieve the binary location for the given type
					const binaryLocation = constants.binaryLocations[binaryType];

					const currentDate = new Date();
					const timestamp = currentDate.getTime();

					// manage files being stored locally
					if (binaryLocation.search('/') === 0) {
						// create file path for local files
						const localFilePath = constants.upload_fullpath + binaryLocation + '/' + binaryFile;

						console.log(localFilePath);
						// check file existence
						if (fs.existsSync(localFilePath)) {
							// update last_download_file and last_download_time fields
							user.setUserField(uid, 'last_download_file', binaryFile);
							user.setUserField(uid, 'last_download_time', timestamp);

							LogDownloadData(db, uid, binaryFile, binaryLocation, binaryType, timestamp, binaryDownloadKey, nextDL, nextMaxonBinaryDownloadField);

							// return result
							res.status(200);
							res.sendFile(localFilePath);
						} else {
							winston.error('[maxonBinary] User (' + uid + ') attempted to download ' + binaryFile + ' but file was not found.');
							callback(new Error('File not found.'));
						}
					} else if (binaryLocation.search('azure') === 0) {
						// update last_download_file and last_download_time fields
						user.setUserField(uid, 'last_download_file', binaryFile);
						user.setUserField(uid, 'last_download_time', timestamp);

						LogDownloadData(db, uid, binaryFile, binaryLocation, binaryType, timestamp, binaryDownloadKey, nextDL, nextMaxonBinaryDownloadField);

						// set container name
						const containerName = binaryLocation.substring(binaryLocation.search('/') + 1);
						// set the blob name
						const blobName = binaryFile;

						// enter your storage account name and shared key
						const account = constants.azureCredentials.storage_name;
						const accountKey = constants.azureCredentials.storage_key;

						// console.log ("containerName: ", containerName, "\nblobName: ", blobName, "\naccount: ", account, "\naccountKey: ", accountKey);

						// create blob service given Azure credentials
						const blobService = azureStorage.createBlobService(account, accountKey);

						// get the blob properties
						blobService.getBlobProperties(containerName, blobName, function (err, blobProperties) {
							if (err) {
								return callback(err);
							}
							const blobSizeMB = blobProperties.contentLength * 0.000001;
							let estimatedDownloadDuration = blobSizeMB / constants.rateMBs;
							// console.log ("constants.rateMBs", constants.rateMBs);
							// console.log ("blobSize (MB)  ", blobSizeMB, "estimatedDownloadDuration (s): ", estimatedDownloadDuration);
							if (estimatedDownloadDuration < 5) estimatedDownloadDuration = 5;

							// define shared policies
							const startDate = new Date();
							const expiryDate = new Date(startDate);
							expiryDate.setSeconds(startDate.getSeconds() + estimatedDownloadDuration);
							startDate.setSeconds(startDate.getSeconds() - 1);
							const sharedAccessPolicy = {
								AccessPolicy: {
									Permissions: azureStorage.BlobUtilities.SharedAccessPermissions.READ,
									Start: startDate,
									Expiry: expiryDate,
								},
							};

							// generate SAS token
							const token = blobService.generateSharedAccessSignature(containerName, blobName, sharedAccessPolicy);

							// prepare expiring URL
							const azureExpiringURL = blobService.getUrl(containerName, blobName, token);
							// redirect to proper destination
							// console.log("azureExpiringURL: ",azureExpiringURL);
							res.redirect(azureExpiringURL);
						});
					} else {
						// update last_download_file and last_download_time fields
						user.setUserField(uid, 'last_download_file', binaryFile);
						user.setUserField(uid, 'last_download_time', timestamp);

						LogDownloadData(db, uid, binaryFile, binaryLocation, binaryType, timestamp, binaryDownloadKey, nextDL, nextMaxonBinaryDownloadField);

						// redirect to proper destination
						res.redirect(binaryLocation + binaryFile);
					}
				});
			} else {
				winston.error('[maxonBinary] Unexpected attempt to download ' + binaryFile + ' without being authentication.');
				callback(new Error('Please log in.'));
			}
		});
		callback(null);
	};

	// Method responsible to reply to requests coming from MaxonBinary custom routes
	MaxonBinary.customAPIRoutes = function (data, callback) {
		const router = data.router;
		const middleware = data.middleware;
		// let helpers = data.helpers;

		// POST request to <backstage>/api/V3/plugins/downloadstats
		router.post('/downloadstats', middleware.authenticate, function (req, res) {
			// check user making the post request
			// likely an authenticated user with API Access token
			if (req.user.uid !== undefined) {
				if (debugOutput) {
					winston.verbose('[maxonBinary] User [' + req.user.uid + '] reached /downloadstats route.');
				}

				// init download log filter variables:
				//     user ID (uid),
				//     from date (fromTS),
				//     to date (toTS),
				//     binary type (binaryType))
				let uid = 0; let fromTS = 0.0; let toTS = 0.0; let
					binaryType = '';

				// Fill download log filter variables with body params
				if (req.body.uid !== undefined) {
					uid = req.body.uid;
				}
				if (req.body.from !== undefined) {
					const fromDate = new Date(req.body.from);
					if (isValidDate(fromDate)) {
						fromTS = fromDate.getTime();
					} else {
						winston.error('[maxonBinary] Wrong format of "body.from". Set as YYYY-MM-DDTHH:mm:ss');
						res.sendStatus(404);
					}
				}
				if (req.body.to !== undefined) {
					const toDate = new Date(req.body.to);
					if (isValidDate(toDate)) {
						toTS = toDate.getTime();
					} else {
						winston.error('[maxonBinary] Wrong format of "body.to". Set as YYYY-MM-DDTHH:mm:ss');
						res.sendStatus(404);
					}
				}
				if (req.body.binarytype !== undefined) {
					if (Object.keys(constants.binaryLocations).includes(req.body.binarytype)) {
						binaryType = req.body.binarytype;
					} else {
						winston.error('[maxonBinary] Binary type [' + req.body.binarytype + '] not supported.');
						res.sendStatus(404);
					}
				}

				let retVal = [];
				// scan DB to retrieve all keys related to "download" logs
				db.scan({ match: binaryDownloadKey + ':*' }, function (err, keys) {
					if (err) {
						return callback(err);
					}
					db.getObjects(keys, function (err, downloadEntries) {
						if (err) {
							return callback(err);
						}
						if (uid > 0) {
							user.getUserField(uid, 'last_download_file', function (err, last_download_file) {
								if (err) {
									return callback(err);
								}
								user.getUserField(uid, 'last_download_time', function (err, last_download_time) {
									if (err) {
										return callback(err);
									}
									retVal = [{ last_download_file: last_download_file, last_download_time: last_download_time }];
									const filteredDownloads = FilterDownloadData(downloadEntries, uid, fromTS, toTS, binaryType);
									retVal.push(filteredDownloads);
									res.send(retVal);
								});
							});
						} else {
							const filteredDownloads = FilterDownloadData(downloadEntries, uid, fromTS, toTS, binaryType);
							res.send(filteredDownloads);
						}
					});
				});
			} else {
				winston.error('[maxonBinary] Undefined req.user.uid');
				res.sendStatus(404);
			}
		});

		winston.info('[maxonBinary] Maxon Binary routes added.');
		callback(null);
	};
}(module.exports));

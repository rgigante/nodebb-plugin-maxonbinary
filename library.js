'use strict';

(function (MaxonBinary) {

	const fs = module.require('fs'); 
	const User = require.main.require('./src/user');
	const Groups = require.main.require('./src/groups');
	const db = require.main.require('./src/database');

	const nconf = module.parent.require('nconf');
	const winston = module.parent.require('winston');
	const express = module.parent.require('express');

	const constants = Object.freeze({
		archive: nconf.get('maxon_binary:archive_path'),
		home: nconf.get('maxon_binary:home_path'),
		binaryLocations: nconf.get('maxon_binary:binary_locations')
	});

	// check the contants object for contain data
	let configOk = false;
	if (!constants.home) {
		winston.error("[maxonBinary] --> NodeBB owner's home not set.");
	} else if (!constants.archive) {
		winston.error('[maxonBinary] --> Binary local folder not set.');
	} else if (!constants.binaryLocations) {
		winston.error('[maxonBinary] --> Binary locations not set.');
	} else {
		configOk = true;
		winston.info('[maxonBinary] --> Config is OK');
	}


	// data <- (app: app, router: params.router, middleware: middleware, controllers: controllers)
	MaxonBinary.retrieveBinary = function(data, callback) {
		let loggedIn = false;
		let uid = -1;
		
		let app = data.app;
		let router = data.router;
		let middleware = data.middleware;
		let controllers = data.controllers;

		console.log("constants: ", constants);

		app.get('/api' + constants.archive + '/:type/:file(*?)', middleware.authenticate, middleware.validateAuth, function (req, res, callback) {
			loggedIn = req.loggedIn;

			// check the user to be logged in
			if (loggedIn)
			{
				const uid = req.user.uid;
				const binaryType = req.params.type;
				const binaryFile = req.params.file;

				// check passed type is among supported binary types
				if (!Object.keys(constants.binaryLocations).includes(binaryType)){
					winston.error('[maxonBinary] --> Binary type [' + binaryType + '] not supported.');
					callback(new Error('Unexpected error. Please contact Backstage Community administrator.'));
				} 

				db.getObjectField('global', 'nextDownload', function (err, val) {
					if (err) {
						return callback(err);
					}

					// check value retrieved from DB
					let nextDL = 1;
					if (!Object.is(val,null)){
						nextDL = val;
					}
					// log the download start request
					winston.verbose('[maxonBinary] --> User (' + uid + ') has requested ' + binaryFile + " [" + binaryType + "]");

					// retrieve the binary location for the given type
					const binaryLocation = constants.binaryLocations[binaryType];

					const currentDate = new Date();
					const timestamp = currentDate.getTime();

					// manage files being stored locally
					if (binaryLocation === "local"){
						// create file path for local files
						const localFilePath = constants.home + constants.archive + '/' + binaryFile;
						// check file existence
						if (fs.existsSync(localFilePath)) {

							User.setUserField(uid, 'last_download_file', binaryFile);
							User.setUserField(uid, 'last_download_time', timestamp);

							var data = {'uid': uid, 'file': binaryFile, 'timestamp': timestamp};
							db.setObject('download:' + String(nextDL), data);
							db.setObjectField('global', 'nextDownload', nextDL + 1);

							res.status(200);
							res.sendFile(localFilePath);

						} else {
							winston.error('[maxonBinary] --> User (' + uid + ') attempted to download ' + binaryFile + ' but file was not found.');
							callback(new Error('File not found.'));
						}
					} else {

						User.setUserField(uid, 'last_download_file', binaryFile);
						User.setUserField(uid, 'last_download_time', timestamp);

						var data = {'uid': uid, 'file': binaryFile, 'timestamp': timestamp};
						db.setObject('download:' + String(nextDL), data);
						db.setObjectField('global', 'nextDownload', nextDL + 1);

						res.redirect(binaryLocation+binaryFile);
					}
				});
			} else {
				winston.error('[maxonBinary] --> Somebody attempted to download ' + binaryFile + ' without being logged in.');
				callback(new Error('Please log in.'));
			}
		});
		callback(null);
	}

	// data <- (router: pluginRouter, middleware, helpers)
	MaxonBinary.initV3Routes = function(data, callback) {

		let router = data.router;
		let middleware = data.middleware;
		let helpers = data.helpers;

		// console.log ("router: ", router);
		// console.log ("middleware: ", middleware);
		// console.log ("helpers: ", helpers);

		router.get('/route0', middleware.authenticate, function(req, res) {
			if (req.user.uid !== undefined){
				winston.verbose("[maxonBinary] --> /route0 reached via get by user: " + req.user.uid);
				res.sendStatus(200);
			}
			else{
				winston.verbose("[maxonBinary] --> req.user.uid is undefined");
				res.sendStatus(404);
			}
		});

		router.post('/route1', middleware.authenticate, function(req, res) {
			if (req.user.uid !== undefined){
				winston.verbose("[maxonBinary] --> /route1 reached via post by user: " + req.user.uid);
				res.sendStatus(200);
			}
			else{
				winston.verbose("[maxonBinary] --> req.user.uid is undefined");
				res.sendStatus(404);
			}
		});
		
		winston.info('[maxonBinary] Maxon Binary routes added.');
		callback(null, data);
	};

	// deprecated
	MaxonBinary.initV1V2Routes = function(data, callback) {

		var app = data.router;
		var apiMiddleware = data.apiMiddleware;
		var middleware = data.middleware;
		var errorHandler = data.errorHandler;
	
		app.get('/routeWrite', apiMiddleware.requireUser, function(req, res) {
			console.log("[maxonBinary] --> req.user.uid: ", req.user.uid);

			if (req.user.uid !== undefined){
				if (req.user.uid == 1){
					winston.verbose("[maxonBinary] --> /routeWrite reached via get");
					res.sendStatus(200);
				}
				else{
					winston.verbose("[maxonBinary] --> invalid user");
					res.sendStatus(404);
				}
			}
		});
	
		callback(null, {
			router: app
		});

	};

}(module.exports));

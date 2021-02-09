'use strict';

(function (module) {

	const fs = module.require('fs'); 
	const User = require.main.require('./src/user');
	const Groups = require.main.require('./src/groups');
	const db = require.main.require('./src/database');

	const nconf = module.parent.require('nconf');
	const winston = module.parent.require('winston');
	const express = module.parent.require('express');

	const constants = Object.freeze({
		archive: nconf.get('maxon_binary:archive_path'),
		home: nconf.get('maxon_binary:home_path')
	});

	// check the contants object for contain data
	let configOk = false;
	if (!constants.home) {
		winston.error('[maxonBinary] --> Home folder of the user starting nodebb not found.');
	} else if (!constants.archive) {
		winston.error('[maxonBinary] --> Archive folder containing binaries not found.');
	} else {
		configOk = true;
		winston.info('[maxonBinary] --> Config is OK');
	}

	const MaxonBinary = {};

	MaxonBinary.retrieveBinary = function(params, callback) {
		let loggedIn = false;
		let uid = -1;
		params.app.get('/api' + constants.archive + '/:file(*?)', function (req, res, callback) {
			loggedIn = req.loggedIn;
			// check the user to be logged in
			if (loggedIn)
			{
				uid = req.user.uid;
				winston.verbose('[maxonBinary] --> User (' + req.user.uid + ') is downloading ' + req.params.file);
				// build absolute path to the file to get
				let filepath = constants.home + constants.archive + '/' + req.params.file;
				// check file existence
				if (fs.existsSync(filepath)) {

					let currentDate = new Date();
					let timestamp = currentDate.getTime();

					User.setUserField(uid, 'last_download_file', req.params.file);
					User.setUserField(uid, 'last_download_time', timestamp);

					db.getObjectField('global', 'nextDownload', function (err, val) {
						if (err) {
							return callback(err);
						}

						// check value retrieved from DB
						let nextDL = 1;
						if (!Object.is(val,null)){
							nextDL = val;
						}

						var data = {'uid': uid, 'file': req.params.file, 'timestamp': timestamp};
						db.setObject('download:' + String(nextDL), data);
						db.setObjectField('global', 'nextDownload', nextDL + 1);
						res.status(200);
						res.sendFile(filepath);
					});
				} else {
					winston.error('[maxonBinary] --> User (' + req.user.uid + ') attempted to download ' + req.params.file + ' but file was not found.');
					callback(new Error('File not found.'));
				}
			} else {
				winston.error('[maxonBinary] --> Somebody attempted to download ' + req.params.file + ' without being logged in.');
				callback(new Error('Please log in.'));
			}
		});
		callback(null);
	}

	module.exports = MaxonBinary;
}(module));

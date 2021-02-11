'use strict';
(function(routes) {



}(module.exports));


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

	// data <- (app: app, router: params.router, middleware: middleware, controllers: controllers)
	MaxonBinary.retrieveBinary = function(data, callback) {
		let loggedIn = false;
		let uid = -1;
		
		let app = data.app;
		let router = data.router;
		let middleware = data.middleware;
		let controllers = data.controllers;

		// console.log ("app: ", app);
		// console.log ("router: ", router);
		// console.log ("middleware: ", middleware);
		// console.log ("controllers: ", controllers);

		app.get('/api' + constants.archive + '/:file(*?)', function (req, res, callback) {
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

	// data <- (router: pluginRouter, middleware, helpers)
	MaxonBinary.initRoutes = function(data, callback) {

		let router = data.router;
		let middleware = data.middleware;
		let helpers = data.helpers;

		// console.log ("router: ", router);
		// console.log ("middleware: ", middleware);
		// console.log ("helpers: ", helpers);

		router.get('/route0', function(req, res) {
			console.log("[maxonBinary] --> isAuthenticated: ", req.isAuthenticated());
			// console.log("[maxonBinary] --> req: ", req);
			winston.verbose("[maxonBinary] --> /route0 reached via get");
			res.sendStatus(200);
		});

		router.post('/route1', function(req, res) {
			console.log("[maxonBinary] --> isAuthenticated: ", req.isAuthenticated());
			console.log("[maxonBinary] --> req: ", req);
			winston.verbose("[maxonBinary] --> /route1 reached via post");
			res.sendStatus(200);
		});
		
		winston.info('[maxonBinary] Maxon Binary routes added.');
		callback(null, data);
	};

	// data <- (router: router, apiMiddleware, middleware, errorHandler)
	MaxonBinary.initWriteRoutes = function(data, callback) {

		var app = data.router;
		var apiMiddleware = data.apiMiddleware;
		var middleware = data.middleware;
		var errorHandler = data.errorHandler;
	
		app.get('/routeWrite', apiMiddleware.requireUser, function(req, res) {
			console.log("[maxonBinary] --> req.user.uid: ", req.user.uid);

			if (req.user.uid !== undefined){
				if (req.user.uid == 1){
					winston.verbose("[maxonBinary] --> /routeWrite reached via post");
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

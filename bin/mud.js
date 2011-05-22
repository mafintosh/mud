#!/usr/bin/env node

var fs = require('fs');
var common = require('common');
var mud = require('../mud');

var HOME = process.env.HOME;
var host = 'mudhub.org';
var port = 80;

var noop = function() {};

var stack = function(err) {
	console.error(err.stack);
};

var argv = process.argv.slice(2);
var args = argv.join(' ').trim();

var method = function() {
	if (argv[0] === 'ls') {
		argv[0] = 'list';
	}
	if (argv[0] in {server:1, inline:1, resolve:1, list:1}) {
		return argv.shift();
	}
	return 'resolve';
}();
var location = function() {
	while (argv.length && (/^--/).test(argv[argv.length-1])) {
		argv.pop();
	}
	return argv.pop();
}();

// additional options here
var compile = (/--compile-advanced/.test(args) && 'advanced') || (/--compile/).test(args);
var fork = /--fork/.test(args);
var stop = /--stop/.test(args);

if (method === 'server') {
	var cp = require('child_process');

	var kill = function(callback) {
		common.step([
			function(next) {
				cp.exec('ps aux | grep node | grep mud | grep server | grep -v ' + process.pid, next);			
			},
			function(aux,next) {
				cp.exec('kill ' + aux.trim().split(/\s+/)[1], next);
			},
			function(next) {
				callback();
			}
		], function() {
			callback();
		});		
	};

	if (stop) {
		kill(noop);
		return;
	}

	common.step([
		function(next) {
			kill(next);
		},
		function(aux, next) {
			fs.realpath('.', next);
		},
		function(path, next) {
			var cmd = 'node '+__dirname+'/../mud-server.js > /dev/null';
			
			if (!fork) {
				cp.exec(cmd, {cws:path});
				next();
				return;
			}
			cp.exec('nohup '+cmd+' &', {cws:path});
			setTimeout(next, 100);
		},
		function() {
			console.log('mud server started on port 10000');
			if (fork) {
				process.exit(0);				
			}
		}
	], stack);
	return;
}
if (method === 'list') {
	mud.list(common.fork(stack, function(mods) {
		if (!mods.length) {
			console.error('no modules found');
			return;
		}
		console.log(mods.join('\n'));
	}));
	return;
}
if (method === 'inline' && location) {
	mud.resolve(location, {inline:true, compile:compile}, common.fork(stack, console.log));
	return;
}
if (method === 'resolve' && location) {
	mud.resolve(location, {compile:compile}, common.fork(stack, console.log));
	return;
}

console.error('usage: mud [option]\n');
console.error('where the options are:');
console.error('  resolve?  url     - resolve the given url');
console.error('  inline    url     - resolve and inline the given url');
console.error('  modules   a,b,..  - load in these modules');
console.error('  server            - run a mud server');
console.error('  list              - list all installed packages');

//console.error('  source    code  - resolve this code');
//console.error('  publish   file  - publish your own package');
//console.error('  install   name  - to install new packages');
//console.error('  uninstall name  - remove package');
//console.error('  compile   mode? - compile the code using the Google Closure Compiler');
//console.error('  global    list  - bind modules to global vars');

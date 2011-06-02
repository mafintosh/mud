#!/usr/bin/env node

var fs = require('fs');
var exec = require('child_process').exec;
var common = require('common');
var http = require('http');

var mud = require('../mud');
var cat = require('../cat');

var HOME = process.env.HOME;

var noop = function() {};

var stack = function(err) {
	console.error(err.stack);
};

// we need to make the dir for hosting external mud code. afterwards we move the included libs to .mud - no overwrites
exec(common.format('mkdir -p {0}/.mud/js_modules && cp -n {1}/../js_modules/* {0}/.mud/js_modules/', HOME, __dirname));

var argv = process.argv.slice(2);
var args = argv.join(' ').trim();

var local = /--local/.test(args);
var host = local ? 'localhost' : 'mudhub.org';
var port = local ? 8000 : 80;

var method = function() {
	if (argv[0] === 'ls') {
		argv[0] = 'list';
	}
	if (argv[0] in {server:1, inline:1, resolve:1, list:1, publish:1, install:1, uninstall:1, update:1, help:1, version:1, modules:1}) {
		return argv.shift();
	}
	return 'resolve';
}();

var namedArg = function() {
	while (argv.length && (/^--/).test(argv[argv.length-1])) {
		argv.pop();
	}
	return argv.pop();
};

var location = namedArg();

// additional options here
var compile = (/--compile-advanced/.test(args) && 'advanced') || (/--compile/).test(args);
var global = /--global/.test(args);
var fork = /--fork/.test(args);
var stop = /--stop/.test(args);

if (method === 'server') {
	var kill = function(callback) {
		common.step([
			function(next) {
				exec('ps aux | grep node | grep mud | grep server | grep -v ' + process.pid, next);			
			},
			function(aux,next) {
				exec('kill ' + aux.trim().split(/\s+/)[1], next);
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
				exec(cmd, {cws:path});
				next();
				return;
			}
			exec('nohup '+cmd+' &', {cws:path});
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
if (method === 'modules') {
	mud.resolveModules(location.split(','), {compile:compile, global:global}, common.fork(stack, console.log));
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
if (method === 'publish' && location) {
	var publishName = namedArg();
	
	publishName = publishName ? publishName.split(/\.js$/i)[0]+'.js' : location.split('/').pop();
	
	var put = http.request({method:'PUT', path:'/r/'+publishName, host:host, port:port});
	
	cat(location, common.fork(stack, function(buf) {
		put.end(buf);
		put.on('response', function(response) {
			if (response.statusCode === 200) {
				return;
			}
			response.pipe(process.stderr);
		});
	}));
	return;
}

var install = function(location, options) {
	options = options || {};
	location = location.split(/\.js$/i)[0]+'.js';
	
	var download = function() {
		console.log('fetching ' + (options.dependency ? 'dependency ' : '') + location);
		
		var get = http.get({path:'/r/'+location, host:host, port:port});

		get.on('response', function(response) {
			if (response.statusCode === 200) {
				response.pipe(fs.createWriteStream(HOME+'/.mud/js_modules/'+location));
				response.on('end', function() {
					var dependencies = response.headers['x-dependencies'] ? response.headers['x-dependencies'].split(',') : [];
					
					dependencies.forEach(function(dep) {
						install(dep, {dependency:true});
					});
				});
				return;
			}
			response.pipe(process.stdout);
		});		
	};
	
	var path = HOME+'/.mud/js_modules/'+location;

	if (options.update) {
		fs.stat(path, function(err) {
			if (err) {
				console.error(location + ' not installed');
			} else {
				download();
			}
		});
		return;
	}
	if (!options.download) {
		fs.stat(path, function(err) {
			if (err) {
				download();
			}
		});
		return;
	}
	download();
};
if (method === 'version') {
	fs.readFile(__dirname+'/../package.json', 'utf-8', common.fork(stack, function(json) {
		json = JSON.parse(json);
		console.log(json.version);
	}));
	return;
}
if (method === 'install' && location) {
	install(location, {download:true});
	return;
}
if (method === 'update' && location) {
	install(location, {update:true});
	return;
}
if (method === 'uninstall' && location) {
	location = location.split('/').pop().split(/\.js$/)[0]+'.js';

	fs.unlink(HOME+'/.mud/js_modules/'+location, function(err) {
		if (err) {
			console.error(location + ' not installed');
		}
	});
	return;
}

console.error('usage: mud [option]\n');
console.error('where the options are:');
console.error('  [resolve]  url         - resolve the given url');
console.error('  inline     url         - resolve and inline the given url');
console.error('  install    name        - fetch and install a module + dependencies');
console.error('  publish    [alias] url - publish a module');
console.error('  update     name        - update an already installed module');
console.error('  uninstall  name        - uninstall a module');
console.error('  modules    a,b,..      - load in these modules');
console.error('  server                 - run a mud server');
console.error('  list                   - list all installed packages');
console.error('  version                - prints the current version');
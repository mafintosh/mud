#!/usr/bin/env node

var fs = require('fs');
var common = require('common');
var mud = require('../mud');

var HOME = process.env.HOME;
var host = 'mudhub.org';
var port = 80;

var noop = function() {};

var argv = function() {
	var options = {};
	var args = process.argv.slice(2);

	var arg = function(key, fn) {
		if (Array.isArray(key)) {
			key.forEach(function(k) {
				arg(k, fn);
			});
			return;
		}
		var regex = Object.prototype.toString.call(key) === '[object RegExp]';
		
		for (var i = 0; i < args.length; i++) {
			if (regex ? key.test(args[i]) : args[i] === key) {
				fn(regex ? args[i] : args[i+1], key);
				return;
			}
			if (args[i].indexOf(key+'=') === 0) {
				fn(args[i].substring(key.length+1), key);
				return;
			}
		}
	};

	arg(['help', 'list', 'ls', 'global'], function(_, key) {
		options[key === 'ls' ? 'list' : key] = true;
	});
	arg(['source','setuser','adduser'], function(source, key) {
		options[key] = source;
	})
	arg('publish', function(filename) {
		options.publish = filename.split('/').pop().split(/\.js$/i)[0];
	});
	arg('server', function(value) {
		if (value === 'stop') {
			options.server = 'stop';
		} else {
			options.server = /^\d+$/.test(value) ? parseInt(value, 10) : 10000;			
		}
	});
	arg(['install', 'uninstall', 'modules', 'update'], function(value, key) {
		options[key] = value ? value.split(',') : [];
	});
	arg('compile', function(value) {
		options.compile = {'simple':'simple', 'advanced':'advanced'}[value] || 'simple';		
	});
	arg(/\.js$/i, function(filename) {
		options.filename = fs.realpathSync(filename);
	});

	return options;
}();

var stack = function(err) {
	if (!err) {
		return;
	}
	console.error(err.stack);
};

if (argv.list) {
	mud.list(common.fork(stack, function(mods) {
		console.log((mods || []).join('\n'));
	}));
	return;
}

var install = function(mod, options, callback) {
	if (!callback) {
		callback = options;
		options = {};
	}
	
	var path = HOME+'/.mud/js_modules/'+mod;	
	
	fs.stat(path, function(err) {
		if (options.cache && !err) {
			callback(null, []);
			return;
		}		
		require('http').get({
			path:'/r/'+mod,
			host:host,
			port:port
		}, function(response) {
			var buf = '';

			if (response.statusCode !== 200) {
				callback(new Error('not found'));				
				return;
			}

			response.setEncoding('utf8');
			response.on('data', function(data) {
				buf += data;
			});
			response.on('end', function() {
				fs.writeFile(path, buf, stack);
				callback(null, response.headers['x-dependencies'] ? response.headers['x-dependencies'].split(',') : []);
			});
		});	
	});
};

if (argv.update) {
	argv.install = argv.update;
}
if (argv.install) {
	argv.install.forEach(function(mod) {		
		var options = {};
		var nextInstall = function(mod) {
			mod += (/\.js$/i.test(mod) ? '' : '.js');

			install(mod, options, function(err, deps) {
				if (err) {
					console.error('module '+mod+' not found')
					return;
				}
				if (deps.length) {
					console.log('resolving dependencies '+deps+' for '+mod);
					options.cache = true;
					deps.forEach(nextInstall);
				}
			});			
		};
		nextInstall(mod);
	});
	return;
}
if (argv.uninstall) {
	argv.uninstall.forEach(function(mod) {
		mod += (/\.js$/i.test(mod) ? '' : '.js');
		
		fs.unlink(HOME+'/.mud/js_modules/'+mod, stack);
	});
	return;
}
if (argv.publish) {
	mud.stat(argv.publish, function(err, stat) {
		if (err || !stat) {
			console.error(argv.publish+' can not be located for publish');
			return;
		}
		var put = require('http').request({
			method:'PUT',
			headers:{'content-length':Buffer.byteLength(stat.src)},
			path:'/r/'+stat.name+'.js',
			host:host,
			port:port
		});
		put.end(stat.src);
	});
	return;
}
if (argv.adduser) {
	return;
}
if (argv.setuser) {
	return;
}
if (argv.server) {
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

	if (argv.server === 'stop') {
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
			cp.exec('nohup node '+__dirname+'/../mud-server.js '+argv.server+' > /dev/null &', {cws:path});
			setTimeout(next, 100);
		},
		function() {
			console.log('mud server started on port '+argv.server);
			process.exit(0);
		}
	], stack);
	return;
}
if (argv.modules || argv.filename || argv.source) {
	mud.resolve(argv, common.fork(stack, function(src) {
		console.log(src);
	}));
	return;
}

console.error('usage: mud [option] [filename]\n');
console.error('where the options are:');
console.error('  install   name  - to install new packages');
console.error('  uninstall name  - remove package');
console.error('  list            - list all installed packages');
console.error('  compile   mode? - compile the code using the Google Closure Compiler');
console.error('  server    port  - run a mud server');
console.error('  global    list  - bind modules to global vars');
console.error('  modules   list  - load in these modules');
console.error('  source    code  - resolve this code');
console.error('  publish   file  - publish your own package');
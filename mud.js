var path = require('path');
var url = require('url');
var fs = require('fs');
var http = require('http');

var common = require('common');

var HOME = process.env.HOME; // probably doesnt work for a windows port
var noop = function() {};

// js file dependencies - used when resolving
var requireJS = fs.readFileSync(__dirname+'/require.js', 'utf-8');

// mud is linked to exports because a lot exports methods are used inside
var mud = exports;

// regex util for matching a group
var match = function(str, regex) {
	var n;
	var matches = [];

	while (n = regex.exec(str)) {
		matches.push(n[n.length-1]);
	}
	return matches;
};

// analyses the src for dependencies in the format require('name') or require('name', 'sub-name', ...)
mud.parseDependencies = function(src) {
	var requires = [];

	match(src, (/require\(((?:'[^']+'(?:\,\s)?)+)\)/g)).forEach(function(names) {
		requires = requires.concat(match(names, (/'([^']+)'/g)));
	});		

	return requires;
};

// crawls upwards from the current directory and finds all js_modules and shared_modules folders
var moduleDirs = function(callback) {
	var dirs = [];
	
	common.step([
		function(next) {
			fs.realpath('.', next);
		},
		function(location, next) {
			while (true) {
				dirs.push(path.join(location, 'js_modules'));
				dirs.push(path.join(location, 'shared_modules'));

				if (location === '/') {
					break;
				}
				location = path.join(location, '..');
			}
			dirs.push(HOME+'/.mud/js_modules');
			dirs.forEach(function(dir) {
				path.exists(dir, common.curry(next.parallel(), null));
			});
		},
		function(exists) {
			callback(null, dirs.filter(function(_,i) {
				return exists[i];
			}));
		}
	], callback);
};

// list all the available modules from the current directory
mud.list = function(callback) {
	common.step([
		function(next) {
			moduleDirs(next);
		},
		function(dirs, next) {
			if (!dirs.length) {
				callback(null, []);
				return;
			}
			dirs.forEach(function(dir) {
				fs.readdir(dir, next.parallel());
			});
		},
		function(dirs) {
			var js = [];
			var res = {};

			dirs.forEach(function(files) {
				js = js.concat(files.filter(function(file) {
					return /\.js$/i.test(file);
				}));
			});
			js.forEach(function(filename) {
				res[filename.split(/\.js$/i)[0]] = true;
			});

			callback(null, Object.keys(res));
		}
	], callback);
};

// build a function that caches the current directory tree and bind name -> cache[name] -> module
var resolver = function() {
	var cache = {};

	var find = function(dirs, name, callback) {
		var module;

		common.step([
			function(next) {
				var crawl = function(p) {
					if (p > dirs.length) {
						callback();
						return;
					}
					var callStat = function(loc, nextLoc) {
						fs.stat(loc, function(err, stat) {
							if (err && nextLoc) {
								callStat(nextLoc);
								return;
							}
							if (err) {
								crawl(p+1);
								return;
							}
							next(null, {modified:stat.mtime.getTime(), path:loc});
						});						
					};
					
					callStat(path.join(dirs[p], name+'.js'), path.join(dirs[p], name+'/index.js'));
				};
				crawl(0);		
			},
			function(stat, next) {
				var cached = cache[name];

				if (cached && cached.path === stat.path && cached.modified === stat.modified) {
					callback(null, cached);
					return;
				}
				module = stat;
				fs.readFile(stat.path, 'utf8', next);
			},
			function(src) {
				cache[name] = module;
				
				module.name = name;
				module.src = src;
				module.dependencies = mud.parseDependencies(src);
				
				callback(null, module);	
			}
		], callback);
	};	
	return function(callback) {
		moduleDirs(common.fork(callback, function(dirs) {
			callback(null, function(name, callback) {
				find(dirs, name, callback);
			});
		}));
	};
}();

mud.module = function(name, callback) {
	resolver(common.fork(callback, function(resolve) {
		resolve(name, callback);
	}));
};

// sends the src the Google's closure compiler
var closure = function(src, type, callback) {
	type = {simple:'SIMPLE_OPTIMIZATIONS', advanced:'ADVANCED_OPTIMIZATIONS'}[type && type.toString().toLowerCase()] || 'SIMPLE_OPTIMIZATIONS';
	
	var post = require('http').request({
		method: 'POST',
		port: 80,
		host: 'closure-compiler.appspot.com',
		path: '/compile',
		headers: {'content-type':'application/x-www-form-urlencoded'}
	});
	post.end('output_info=compiled_code&compilation_level='+type+'&warning_level=default&js_code='+encodeURIComponent(src));

	post.on('error', callback);
	post.on('response', function(response) {
		var buf = '';

		response.setEncoding('utf8');
		response.on('data', function(data) {
			buf += data;
		});
		response.on('end', function() {
			callback(null, (!buf.trim() || (/^Error/).test(buf)) ? src : buf);
		});
	});			
};

var inlineModules = function(modules, callback) {
	var resolved = {};
	
	var resolveAll = function(resolve, modules, callback) {
		common.step([
			function(next) {
				modules = modules.filter(function(mod) {
					return !resolved[mod];
				});
				if (!modules.length) {
					callback();
					return;
				}
				modules.forEach(function(mod) {
					resolved[mod] = true;
					resolve(mod, next.parallel());
				});
			},
			function(results, next) {
				var missing = {};
				
				results.forEach(function(result) {
					if (!result) {
						return;
					}
					resolved[result.name] = result.src;
					result.dependencies.forEach(function(dep) {
						missing[dep] = true;
					});
				});
				missing = Object.keys(missing);

				if (!missing.length) {
					callback();
					return;
				}
				resolveAll(resolve, missing, next);
			},
			function() {
				callback();
			}
		], callback);
	};
	
	common.step([
		function(next) {
			resolver(next);
		},
		function(resolve, next) {
			resolveAll(resolve, modules, next);
		},
		function() {
			var result = requireJS + '\n';

			for (var name in resolved) {
				if (typeof resolved[name] !== 'string') {
					continue; // unknown module
				}
				result += common.format('require.define("{0}", function(module, exports) {\n{1}\n});\n', name, resolved[name]);
			}

			callback(null, result);			
		}
	], callback);
};

mud.resolveModules = function(modules, options, callback) {
	if (!callback) {
		callback = options;
		options = {};
	}
	common.step([
		function(next) {
			inlineModules(modules, next);
		},
		function(result, next) {			
			if (options.global) {
				modules.forEach(function(mod) {
					result += common.format('window["{0}"] = require("{0}");\n', mod);
				});
				result = common.format('(function(require) {\n{0}\n}());', result);
			}
			if (options.compile) {
				closure(result, options.compile, next);
			} else {
				next(null, result);
			}
		},
		function(result) {
			callback(null, result);
		}
	], callback);
};

// read from a location given a protocol (defaults to file) and buffer the result
var cat = function(location, callback) {
	var protocol = (location.match(/(\w+):\/\//) || [])[1] || 'file';
		
	if (protocol === 'file') {
		fs.readFile(location.replace(/^(file:\/\/localhost|file:\/\/)/, ''), 'utf8', callback);
		return;
	}
	if (protocol === 'http') {	
		http.cat(location, callback);
		return;
	}
	throw new Error('protocol '+protocol+' currently not supported :(');
};

// location -> {main:string, type:js|html, scripts:[string], modules:[string]}
var crawl = function(location, callback) {
	var result = {scripts:[], modules:[]};
	
	common.step([
		function(next) {
			cat(location, next);
		},
		function(src, next) {
			result.type = /^\s*</.test(src) ? 'html' : 'js';
			result.main = src;
			
			var scripts = result.type === 'js' ? [] : match(src, (/<script .*src=['"](.*)["']>/g)).filter(function(script) {
				// only same domain url - design decision
				return !(/\w+:\/\//).test(script);
			});
			
			if (!scripts.length) {
				next(null, []);
				return;
			}
			scripts.forEach(function(script) {
				cat(url.resolve(location, script), next.parallel());
			});
		},
		function(scripts) {
			result.scripts = scripts;
			
			scripts.concat([result.main]).forEach(function(script) {
				result.modules = result.modules.concat(mud.parseDependencies(script));
			});
			
			callback(null, result);
		}
	], callback);
};

mud.resolve = function(location, options, callback) {
	if (!callback) {
		callback = options;
		options = {};
	}
	var main;
	var type;
	
	common.step([
		function(next) {
			crawl(location, next);
		},
		function(result, next) {
			main = result.main;
			type = result.type;

			inlineModules(result.modules, next);
		},
		function(result, next) {
			if (options.inline && type === 'js') {
				result += '\n'+main;
			}
			if (options.compile) {
				closure(result, options.compile, next);
			} else {
				next(null, result);
			}
		},
		function(result) {
			if (options.inline && type === 'html') {
				result = main.replace(/<script ([^>]*)src=["'].*\/dev["']([^>]*)>\s*<\/script>/i, function(_, a, b) {
					return ('<script '+a+b+'>\n').replace(/\s+/g, ' ').replace(' >', '>')+result+'\n</script>';
				});	
			}
			callback(null, result);
		}
	], callback);
};
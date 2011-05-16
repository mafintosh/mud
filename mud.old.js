var fs = require('fs');
var path = require('path');
var common = require('common');

var HOME = process.env.HOME;

var noop = function() {};

var closure = function(src, type, callback) {
	type = {simple:'SIMPLE_OPTIMIZATIONS', advanced:'ADVANCED_OPTIMIZATIONS'}[type] || 'SIMPLE_OPTIMIZATIONS';
	
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
			callback((!buf.trim() || /^Error/.test(buf)) && new Error('Compilation failed'), buf);
		});
	});			
};
var normalize = function(mods) {
	var res = {};
	
	for (var name in mods) {
		if (typeof mods[name] === 'string') {
			res[name.split('@')[0]] = mods[name];
		}
	}
	return res;
};
var dependencies = function() {
	var match = function(str, regex) {
		var n;
		var matches = [];

		while (n = regex.exec(str)) {
			matches.push(n[n.length-1]);
		}
		return matches;
	};
	return function(code) {
		var requires = [];

		match(code, (/require\(((?:'[^']+'(?:\,\s)?)+)\)/g)).forEach(function(names) {
			requires = requires.concat(match(names, (/'([^']+)'/g)));
		});		

		return requires;
	};
}();
var list = function(dirs, callback) {
	if (!dirs.length) {
		callback(null, []);
		return;
	}
	common.step([
		function(next) {
			dirs.forEach(function(dir) {
				fs.readdir(dir, next.parallel());
			});
		},
		function(dirs) {
			var js = [];
			var res = {};
			
			dirs.forEach(function(files) {
				js = js.concat(files.filter(function(file) {
					return /.js$/i.test(file);
				}));
			});
			js.forEach(function(filename) {
				res[filename.split(/.js$/i)[0]] = true;
			});
			
			callback(null, Object.keys(res));
		}
	], callback);
};
var find = function(dirs, name, callback) {
	var next = function(p) {
		if (p > dirs.length) {
			callback();
			return;
		}
		var loc = path.join(dirs[p], name+'.js');
		
		fs.stat(loc, function(err, stat) {
			if (err) {
				next(p+1);
				return;
			}
			callback({modified:stat.mtime.getTime(), path:loc});
		});
	};
	next(0);
};

var cache = {};
var resolver = function(callback) {
	var dirs = [];

	common.step([
		function(next) {
			fs.realpath('.', next);
		},
		function(loc, next) {
			while (true) {
				dirs.push(path.join(loc, 'js_modules'));
				dirs.push(path.join(loc, 'shared_modules'));
				
				if (loc === '/') {
					break;
				}
				loc = path.join(loc, '..');
			}
			dirs.push(HOME+'/.mud/js_modules');
			dirs.forEach(function(dir) {
				path.exists(dir, common.curry(next.parallel(), null));
			});
		},
		function(exists) {
			dirs = dirs.filter(function(_,i) {
				return exists[i];
			});
			callback(null, function(name, callback) {
				if (typeof name === 'function') {
					list(dirs, name);
					return;
				}
				find(dirs, name, function(map) {
					if (!map) {
						callback(null, null);
						return;
					}
					var cached = cache[name];

					if (cached && cached.path === map.path && cached.modified === map.modified) {
						callback(null, cached);
						return;
					}
					fs.readFile(map.path, 'utf8', common.fork(callback, function(src) {
						cache[name] = map;
						
						map.name = name;
						map.src = src;
						map.dependencies = dependencies(src);
						
						callback(null, map);
					}));
				});
			});
		}
	], callback);
};

var jsonjs = fs.readFileSync(__dirname + '/js/JSON.js', 'utf8');
var requirejs = fs.readFileSync(__dirname + '/js/require.js', 'utf8');

exports.stat = function(module, callback) {
	resolver(common.fork(callback, function(resolve) {
		resolve(module, callback);
	}));
};
exports.list = function(callback) {
	resolver(common.fork(callback, function(resolve) {
		resolve(callback);
	}));
};
exports.resolve = function(options, callback) {
	options.modules = options.modules || [];
	
	common.step([
		function(next) {			
			if (options.filename) {
				fs.readFile(options.filename, 'utf8', next.parallel());
			} else {
				next.parallel()(null, options.source || '');
			}
			resolver(next.parallel());
		},
		function(res) {
			var file = res[0];
			var resolve = res[1];
			var deps = options.modules.concat(dependencies(file));

			if (/\s*</.test(file) && !options.modulesOnly) { // if the input is html and we wanna resolve everything
				exports.resolve({source:file, modulesOnly:true, compile:options.compile, modules:options.modules}, common.fork(callback, function(result) {
					result = file.replace(/<script ([^>]*)src=["'].*\/dev["']([^>]*)>\s*<\/script>/i, function(_, a, b) {
						return ('<script '+a+b+'>\n').replace(/\s+/g, ' ').replace(' >', '>')+result+'\n</script>';
					});
					callback(null, result);
				}));
				return;
			}

			var resolved = {};
			var load = function(mods, callback) {
				mods = mods.filter(function(mod) {
					return !resolved[mod];
				});

				if (!mods.length) {
					callback();
					return;
				}
				common.step([
					function(next) {
						mods.forEach(function(mod) {
							resolved[mod] = true;
							resolve(mod, next.parallel());
						});
					},
					function(mods, next) {
						mods = mods.filter(function(mod) {
							return mod;
						});
						if (!mods.length) {
							callback();
							return;
						}
						mods.forEach(function(mod) {							
							resolved[mod.name] = mod.src;
							load(mod.dependencies, next.parallel());
						});
					},
					function() {
						callback();
					}
				], callback);
			};
			
			var result = requirejs+'\n'+jsonjs+'\n';
			
			load(deps, common.fork(callback, function() {
				resolved = normalize(resolved);

				for (var name in resolved) {
					result += common.format('require.define("{0}", function(module, exports) {\n{1}\n});\n', name, resolved[name]);
				}
				if (!options.modulesOnly) {
					result += file;
				}
				if (options.global) {
					options.modules.forEach(function(mod) {
						result += common.format('window["{0}"] = require("{0}");\n', mod);
					});
					result = common.format('(function(require) {\n{0}\n}());', result);
				}
				if (!options.compile) {
					callback(null, result);					
					return;
				}
				closure(result, options.compile, callback);
			}));
		}
	], callback);
};
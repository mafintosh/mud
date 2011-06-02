(function() {
	if (typeof require !== 'undefined') {
		return; // define only once
	}
	
	var noop = function() {};
	var modules = {};
	var definitions = {};
	
	require = function(name) {
		if (arguments.length > 1) { // this syntax allows for and module and it's plugins to be loaded
			var val = require(arguments[0]);

			for (var i = 1; i < arguments.length; i++) {
				require(arguments[i]);
			}
			return val;
		}
		name = name.split('@')[0]; // TODO: make this versioning a lot better
		
		if (definitions[name] && !modules[name]) { // if not already loaded and an def exists
			var def = definitions[name];
			
			delete definitions[name];
			
			var module = modules[name] = function() {
				return module.exports;
			};
			
			module.browser = true; // allows for non-hacky browser js detection
			module.exports = {};
			
			def(module, module.exports);
		}
		
		return window[name] || (modules[name] || noop)();
	};
	
	require.define = function(name, def) {
		definitions[name] = def;
	};
}());
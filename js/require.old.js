(function() {
	if (typeof require !== 'undefined') {
		return; // define only once
	}
	
	var modules = {};
	var lazies = {};
	
	module = function(name) {
		return modules[name] = {};
	};
	module.define = function(name, fn) {
		lazies[name] = fn;		
	};
	module.browser = true; // for non-hacky browser/node.js detection
	
	require = modules.require = function(name) {
		if (arguments.length > 1) {
			var val = require(arguments[0]);

			for (var i = 1; i < arguments.length; i++) {
				require(arguments[i]);
			}
			return val;
		}
		name = name.split('@')[0];
		if (lazies[name]) {
			var lazy = lazies[name];

			delete lazies[name];
			lazy();
		}	
		return modules[name] || window[name];
	};
})();
# Mud
Mud is a simple browser Javascript package manager written in Node.js

It is available through `npm`:

	npm install -g mud

Mud allows the for usage of the `require` function in the browser.
It does this by analyzing dependencies in your code and looks for the valid modules inside `js_modules` folders.

Say you have a html file that looks like this:

	<html><head>
		<script src='http://localhost:10000/dev'></script>
		<script>
			var foo = require('foo');
			
			console.log(foo.bar());
		</script>
	</head><body></body></html>

and have started a mud server by doing `mud server` in the terminal (starts a server on port 10000).

If you then open the above file in the browser the html file will send a `/dev` request to the mud server.
The mud server will then recursively lookup the file doing the `/dev` request and analyze it for dependencies.
These dependencies can come from inlined Javascript as in the example or from Javascript referenced through `script` tags.

In the above example it finds a dependency for `foo`. The server then looks for a file `foo.js` inside folders named `js_modules` or `shared_modules`.
It starts by looking in the same server it was started and then moves towards `/` until it finds `foo.js`.

# Modules

Modules can be written using a global variable named the same as the file (fx `window.foo` if the file is named `foo.js`) or by using Common.JS syntax as in node.js

	// assume this file is called foo.js and it's parent dir is js_modules
	
	var a = 42; // this DOESNT result in a global varible when required using mud
	
	exports.bar = function() {
		return 'lolz';
	};

# Help

Run `mud help` to get a full list of all the available commands
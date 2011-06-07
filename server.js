var common = require('common');
var markdoc = require('markdoc');
var web = require('web');
var fs = require('fs');

var mud = require('./mud');

var router = web.createRouter();

router.get(/^\/s\//, web.onfilerequest(__dirname)); // static files from the /s/ dir

router.put(/^\/r\/([^\/]+\.js$)/i, function(request, response) {
	var mod = '';

	request.setEncoding('utf8');
	request.on('data', function(data) {
		mod += data;
	});
	request.on('end', function() {
		var file = request.matches[1];
		var name = file.split(/\.js$/i)[0];
		var deps = mud.parseDependencies(mod);
		
		common.step([
			function(next) {
				mud.list(next);
			},
			function(list, next) {
				var unknowns = [];

				for (var i in deps) {
					if (list.indexOf(deps[i]) === -1) {
						unknowns.push(deps[i]);
					}
				}

				if (unknowns.length) {
					response.writeHead(500); // find better status code
					response.end('Error! unpublished dependencies:\n' + unknowns.join(' ')+'\n');
					return;
				}
				fs.writeFile(__dirname+'/js_modules/'+file, mod, next);				
			},
			function(mod) {
				response.writeHead(200, {connection:'close'});
				response.end();
			}
		], function(err) {
			response.writeHead(500, {connection:'close'});
			response.end();
		});

	});
});
router.get(/^\/r\/([^\/]+\.js$)/i, function(request, response) {
	var file = request.matches[1];
	var name = file.split(/\.js$/i)[0];
	
	mud.module(name, function(err, mod) {
		if (err) {
			response.writeHead(404);
			response.end();
			return;
		}
		response.writeHead(200, {
			'content-type':'application/javascript', 
			'content-length':Buffer.byteLength(mod.src),
			'x-dependencies':mod.dependencies+''
		});
		response.end(mod.src);		
	});
});

router.get('/dev', function(request, response) { // shortcut - TODO: check if referrer is changed after redirect
	response.writeHead(301, {location:'http://localhost:10000/dev'});
	response.end();
});
router.get(/^\/g\/(.+)/, function(request, response) { // global modules
	mud.resolveModules(request.matches[1].split(','), {global:true}, function(err, src) {
		response.writeHead(200, {'content-type':'application/javascript'});
		response.end(src || '');
	});
});
router.get(/^\/m\/(.+)/, function(request, response) { // regular modules
	mud.resolveModules(request.matches[1].split(','), function(err, src) {
		response.writeHead(200, {'content-type':'application/javascript'});
		response.end(src || '');
	});
});
router.get(/^\/d\/(.+)/, function(request, response) {
	mud.module(request.matches[1].split(/\.js$/i)[0], function(err, module) {
		response.writeHead(200, {'content-type':'text/html'});
		response.end(markdoc.parseCode(module.src));
	});
});

router.get('/list', function(request, response) {
	mud.list(function(err, list) {
		response.writeHead(200, {'content-type':'application/javascript'});
		response.end(JSON.stringify(list));
	});
});
router.get('/bin', '/s/bin.html', router.route);
router.get('/', '/s/index.html', router.route);

router.listen(parseInt(process.argv[2] || 8000, 10));

process.on('uncaughtException', function(err) {
	console.log(err.stack);
})
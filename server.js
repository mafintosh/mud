var common = require('common');
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

		common.step([
			function(next) {
				fs.writeFile(__dirname+'/js_modules/'+file, mod, next);				
			},
			function(next) {				
				mud.stat(name, next);
			},
			function(stat) {
				response.writeHead(200, {connection:'close', 'x-dependencies':stat.dependencies});
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
	
	mud.stat(name, function(err, stat) {
		if (err) {
			response.writeHead(404);
			response.end();
			return;
		}
		response.writeHead(200, {
			'content-type':'application/javascript', 
			'content-length':Buffer.byteLength(stat.src),
			'x-dependencies':stat.dependencies+''
		});
		response.end(stat.src);
	});
});

router.get('/dev', function(request, response) { // shortcut - TODO: check if referrer is changed after redirect
	response.writeHead(301, {location:'http://localhost:10000/dev'});
	response.end();
});
router.get(/^\/g\/(.+)/, function(request, response) { // global modules
	var modules = request.matches[1].split(',');
	
	mud.resolve({modules:modules, global:modules}, function(err, src) {
		response.writeHead(200, {'content-type':'application/javascript'});
		response.end(src || '');
	});
});
router.get(/^\/m\/(.+)/, function(request, response) { // regular modules
	mud.resolve({modules:request.matches[1].split(',')}, function(err, src) {
		response.writeHead(200, {'content-type':'application/javascript'});
		response.end(src || '');
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

router.listen(80);

process.on('uncaughtException', function(err) {
	console.log(err.stack);
})
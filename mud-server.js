var web = require('web');
var common = require('common');
var mud = require('./mud');
var markdoc = require('markdoc');

var router = web.createRouter();
var port = parseInt(process.argv[2] || 10000,10);

router.get(/^\/dev(?:\?ref=(.*))?$/, function(request, response) {
	var ref = request.matches[1] ? decodeURIComponent(request.matches[1]) : request.headers.referer;
	var respond = function(err, src) {
		response.writeHead(200, {'content-type':'application/javascript'});
		response.end(src || '');
	};

	if (!ref) {
		var host = request.headers.host.split(':')[0]+':'+port;

		respond(null, common.format('document.write(\'<script src="http://{0}/dev?ref=\'+window.location+\'"></script>\');', host));
		return;
	}
	
	mud.resolve(ref, respond);
});
router.get(/^\/d\/(.+)/, function(request, response) {
	mud.module(request.matches[1].split(/\.js$/i)[0], function(err, module) {
		response.writeHead(200, {'content-type':'text/html'});
		response.end(markdoc.parseCode(module.src));
	});
});
router.get(/^\/m\/(.+)/, function(request, response) {
	mud.resolveModules(request.matches[1].split(','), function(err, src) {
		response.writeHead(200, {'content-type':'application/javascript'});
		response.end(src || '');		
	});
});
router.get(/^\/g\/(.+)/, function(request, response) {
	mud.resolveModules(request.matches[1].split(','), {global:true}, function(err, src) {
		response.writeHead(200, {'content-type':'application/javascript'});
		response.end(src || '');		
	});
});
router.get(/^\/p\/(.+)/, function(request, response) {
	response.writeHead(200, {'content-type':'text/html'});
	response.end('<html><head><title>mud play</title><script src="/m/'+request.matches[1]+'"></script></head><body></body></html>');
});

router.get(web.onfilerequest('.'));

router.listen(port);
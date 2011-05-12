var web = require('web');
var common = require('common');
var mud = require('./mud');

var router = web.createRouter();
var port = parseInt(process.argv[2] || 10000,10);

var load = function(url, callback) {
	if (/^http:\/\//.test(url)) {
		require('http').cat(url, callback);
		return;
	}
	if (/^file:\/\//.test(url)) {
		url = url.replace('file://localhost/', '/').replace('file://', '');		
		require('fs').readFile(url, 'utf8', callback);
		return;
	}
	callback(new Error('unknown protocol'));
};

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
	
	load(ref, function(err, html) {
		mud.resolve({source:html, modulesOnly:true}, respond);
	});
});
router.get(/^\/m\/(.+)/, function(request, response) {
	mud.resolve({modules:request.matches[1].split(',')}, function(err, src) {
		response.writeHead(200, {'content-type':'application/javascript'});
		response.end(src || '');
	});
});
router.get(/^\/g\/(.+)/, function(request, response) {
	mud.resolve({modules:request.matches[1].split('/'), global:true}, function(err, src) {
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
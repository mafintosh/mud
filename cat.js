var http = require('http');
var fs = require('fs');

module.exports = function(location, callback) {
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

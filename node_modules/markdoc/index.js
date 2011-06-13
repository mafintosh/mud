var format = require('common').format;
var markdown = require('node-markdown').Markdown;

var wrapper = require('fs').readFileSync(__dirname+'/markdoc.html','utf-8');

exports.parse = function(md) {
	return format(wrapper, markdown(md));
};
exports.parseCode = function(code) {
	var matches = code.match(/\/\*\*([^*]|\*+[^*\/])*\*+\//g) || [];
	
	matches.forEach(function(match, i) {
		matches[i] = match.replace(/(^\/\*+)|(\*+\/)/g, '').replace(/\n[ \t]*\*+[ \t]?/g, '\n').trim();
	});
	
	return exports.parse(matches.join('\n\n'));
};

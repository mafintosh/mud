(function(exports) {
	// this module currently supports all newer versions of Safari, Opera, Chome, Firefox and IE
	// as well as the mobile version of Safari.
	// IE 6+7 support is in development (currently only same-origin)

	var common = require('common');
	var ajax = require('ajax');
	var messaging = require('messaging');
	
	var noop = function() {};
	
	var createRequest = function() {
		var hoster = function(host, https) {
			host = (https ? 'https://' : 'http://')+host;			
			
			return function(url) {
				return host+url;
			};
		};
		
		if (ajax.cors) {
			return function(host, https) {
				var that = {};
				var abort = noop;
				var hostify = hoster(host, https);
		
				that.type = 'ajax';
				that.get = function(url, callback) {
					abort = ajax.get(hostify(url), callback);
				};
				that.post = function(url, data, callback) {
					abort = ajax.post(hostify(url), data, callback);
				};
				that.destroy = function() {
					abort();
				};
				return that;
			};
		}
		return function(host, https) {
			var that = {};
			var cb = noop;
			var hostify = hoster(host, https);
			
			var frame = document.createElement('iframe');
			
			frame.src = hostify('/sockets/xajax');
			frame.style.display = 'none';
			
			var onbody = common.future();
			
			onbody.get(function(body) {
				body.appendChild(frame);
			});

			if (document.body) {
				onbody.put(document.body);
			} else {
				var id = setInterval(function() {
					if (document.body) {
						clearInterval(id);
						onbody.put(document.body);
					}
				}, 100);
			}
			
			var xss = messaging.connect(frame);
			
			xss.on('message', function(m) {
				var index = m.indexOf('\n');
				var err = m.substring(0, index);
				var res = m.substring(index+1);
				var callback = cb;

				cb = noop;
				err = err && new Error(err);

				callback(err, res);					
			});			
			
			that.type = 'framed-ajax';
			that.get = function(url, callback) {
				cb = callback;
				xss.send('get\n'+url+'\n');
			};
			that.post = function(url, data, callback) {
				cb = callback;
				xss.send('post\n'+url+'\n'+data);
			};
			that.destroy = function() {
				cb(new Error('request was aborted'));
				cb = noop;

				xss.send('abort\n\n');
				xss.destroy();

				onbody.get(function(body) {
					body.removeChild(frame);					
				});
			};
			return that;
		};
	}();
	
	var resolve = function() {
		var cnt = 0; // for easier debugging we add a counter to the host if possible
		
		return function(address) {
			return address.replace(/(^|\.)\*\./g, '$1s-'+(cnt++).toString(36)+'x'+Math.random().toString(36).substring(2)+'.');
		};
	}();	
	var time = function() {
		return (new Date().getTime());
	};
	
	// socket utils
	var onmessage = function(that, data) {
		if (data === 'pong') {
			return;
		}
		that.emit('message', JSON.parse(data));
	};
	var heartbeat = function(that, send) {
		var interval = setInterval(function() {
			send('ping');			
		}, 60*1000);
		
		that.on('close', function() {
			clearInterval(interval);
		});
	};
	
	var createLongPoll = function(address) {
		var that = common.createEmitter();
		
		address = resolve(address);
		
		var read = createRequest(address);
		var write = createRequest(address);
		
		var send = function() {
			throw new Error('socket is not writable');
		};
		var fork = function(fn) {
			return function(err, val) {
				if (err) {
					that.destroy();
					return;
				}
				fn(val);
			};
		};
		
		read.get('/sockets/connect?t='+time(), fork(function(id) {
			var buffer = [];
			
			var loop = function() {
				read.get('/sockets/read?t='+time()+'&id='+id, fork(function(data) {
					data = data.split('\n');
					
					for (var i = 0; i < data.length; i++) {
						onmessage(that, data[i]);
					}
					loop();
				}));
			};
			var flush = function() {
				var flushing = false;
				
				return function() {					
					if (flushing || !buffer.length) {
						return;
					}
					flushing = true;
					var data = buffer.join('\n');

					buffer = [];
					write.post('/sockets/write?t='+time()+'&id='+id, data, fork(function() {
						flushing = false;
						flush();
					}));
				};
			}();
						
			send = function(data) {				
				buffer.push(data);
				flush();
			};
			
			heartbeat(that, send);
			loop();
			
			that.emit('open');
		}));
		
		that.type = 'long-poll-'+read.type;
		that.destroy = function() {
			that.destroy = noop; // only call this once
			read.destroy();
			write.destroy();

			that.emit('close');
		};
		that.send = function(data) {
			send(JSON.stringify(data));
		};
		
		return that;
	};
	
	var createWebSocket = function(address) {
		var that = common.createEmitter();
		
		var socket = new WebSocket('ws://'+resolve(address));		
		
		var send = function(data) {
			throw new Error('socket is not writable');
		};
		
		socket.onmessage = function(evt) {
			onmessage(that, evt.data.split('\n')[1]);
		};		
		socket.onopen = function() {
			send = function(data) {
				socket.send(unescape(encodeURIComponent(data)).length+'\n'+data+'\n');							
			};
			
			heartbeat(that, send);
			
			that.emit('open');
		};
		socket.onclose = function() {
			that.emit('close');
		};
		
		that.type = 'web-socket';
		that.destroy = function() {
			socket.close();
		};
		that.send = function(message) {
			send(JSON.stringify(message));
		};
		
		return that;		
	};

	var addressify = function(port, host) {
		if (typeof port === 'string') {
			return port;
		}
		port = parseInt(port || window.location.port || 80, 10);
		host = host || window.location.hostname;
		
		if (port === 80) {
			return host;
		}
		return host+':'+port;
	};
	
	var createSocket = window.WebSocket ? createWebSocket : createLongPoll;

	exports.connect = function(port, host) {		
		var that = common.createEmitter();
		
		var address = addressify(port, host);		
		var socket = createSocket(address);

		var stack = [];
		var buffer = function(message) {
			stack.push(message);
		};

		that.send = buffer;
		that.readyState = 'opening';

		socket.on('open', function() {
			that.send = socket.send;
			that.readyState = 'open';

			while (stack.length) {
				that.send(stack.shift());
			}

			that.emit('open');			
		});
		socket.on('message', function(message) {
			that.emit('message', message);
		});
		socket.on('close', function() {
			that.readyState = 'closed';
			that.emit('close');
		});

		that.destroy = function() {
			that.readyState = 'closed';
			socket.destroy();
		};

		return that;
	};
	
}(module('sockets')));

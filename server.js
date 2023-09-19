const net = require('net');

const path = require('path');
const http = require('http');
const express = require('express');
const Layer = require('express/lib/router/layer');
const cookieParser = require("cookie-parser");
const bodyParser = require('body-parser');
const WS = require('express-ws');
const compression = require('compression');
const { isAsyncFunction } = require('util/types');

const app = express();
WS(app);
app.use(compression());
app.set('json spaces', 4);

app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: false, limit: '16mb' }));
app.use(bodyParser.json({ limit: '16mb' }));

const wsConns = {};

app.get('/', (req, res) => {
	res.type('application/json');
	res.send(Object.keys(wsConns).map(addr => {
		return { addr, conns: wsConns[addr].wses.length };
	}));
});

app.ws('/ws/:addr', (ws, req) => {
	const addr = req.params.addr;
	let wsConn;
	if (addr in wsConns) {
		wsConn = wsConns[addr];

		if (wsConn.isConn && wsConn.sock) wsConn.sock.send('Connected to ' + addr + ' success\n');
	} else {
		const addrs = addr.split(':');
		const host = addrs[0];
		const port = parseInt(addrs[1]);
		const sock = new net.Socket();

		wsConns[addr] = wsConn = { wses: [], sock, isConn: false };

		const send = function (data) {
			wsConn.wses.forEach(c => c.send(data));
		};

		let timer = setTimeout(() => {
			send('Connect to ' + addr + ' timeout\n');
			sock.destroy();
		}, 3000);

		sock.setEncoding('utf-8');
		sock.connect(port, host, function () {
			clearInterval(timer);
			timer = 0;
			
			wsConn.isConn = true;
			send('Connected to ' + addr + ' success\n');
		});
		sock.on('data', function (data) {
			// process.stdout.write(data);
			send(data);
		});
		sock.on('error', function (err) {
			send('Error(' + addr + '): ' + err.message + '\n');
		});
		sock.on('close', function () {
			delete wsConn.sock;
			wsConn.isConn = false;

			send('Closed to ' + addr + '\n');

			wsConn.wses.forEach(ws => ws.close());

			sock.destroy();

			delete wsConns[addr];
		});
	}
	wsConn.wses.push(ws);

	ws.on('message', function (data) {
		// process.stdout.write(data);
		if (wsConn.sock) wsConn.sock.write(data);
	});

	ws.on('close', function () {
		const i = wsConn.wses.indexOf(ws);
		wsConn.wses.splice(i, 1);
		if (!wsConn.wses.length) {
			if (wsConn.sock) {
				wsConn.sock.destroy();
				delete wsConn.sock;
			}
		}
	});
});

app.use(function (err, req, res, next) {
	if (err) {
		console.error(err);

		const message = err.message || '异常错误';
		if (req.headers['x-requested-with'] === 'XMLHttpRequest' || req.url.startsWith('/api/')) {
			res.json({ status: false, message, data: config.isDev ? err.stack : [] });
		} else {
			res.setHeader('Content-Type', 'text/plain; charset=utf-8');
			res.status(500);
			res.send(config.isDev ? err.stack : message);
		}
	} else {
		next();
	}
});

const HTTP_PORT = 3004;
const httpServer = http.createServer(app);
WS(app, httpServer);
httpServer.listen(HTTP_PORT, '0.0.0.0');
httpServer.on('error', console.error);
httpServer.on('listening', function () {
	console.log('Listen port is', HTTP_PORT);
});

Layer.prototype.handle_request = function (req, res, next) {
	const fn = this.handle;

	if (fn.length > 3) {
		// not a standard request handler
		return next();
	}

	if (isAsyncFunction(fn)) {
		fn(req, res, next).then(r => {
			if (r === undefined) return;

			// console.log(r);

			if (typeof (r) === 'string') {
				res.send(r);
			} else {
				res.json(r);
			}
		}).catch(e => {
			next(e);
		});
	} else {
		try {
			fn(req, res, next);
		} catch (err) {
			next(err);
		}
	}
};

process.on('uncaughtException', console.error);

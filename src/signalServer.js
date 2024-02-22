import { createServer } from "http";
import { Server } from 'socket.io';
import { Logger } from './logger.js';
import { config } from "../index.js";
import { getIP } from "./util.js";


const map = {
	server: {
		// 'server': {
		// 	ws: '',
		//  ver: 0.1,
		// 	list: {'uuid': true},
		// },
	},
	client: {
		// 'uuid': {
		// 	ws: '',
		// 	server: 'server',
		// },
	},
};


const logger = new Logger();
logger.prefix = '[SignalServer] ';

const httpServer = createServer((req, res) => {
	logger.info(`[HTTP] [${getIP(req)}]: ${req.url}`);
	res.writeHead(301, {'Location': 'https://ipacel.cc'});
	res.end();
});
const io = new Server(httpServer);

io.on('connection', (socket) => {

	// console.log(socket.request.headers);

	socket.ipac = {
		type: null,		// 'CLIENT' || 'SERVER'
		server: null,	// Server UUID
		uuid: null,		// Client UUID || null
		ip: getIP(socket),	// 由 Signal 服务器获取到的客户端 IP 地址
	};

	logger.info(`[WS] 建立连接[${socket.ipac.ip}]: ${socket.id}`);
	
	// // 监听所有消息
	// socket.onAny((eventName, ...args) => {
	// 	logger.info(`[DEBUG] [${eventName}]:`, args);
	// });


	// 服务端注册事件
	socket.on(`ServerReg`, (data) => {
		const inp = {
			version: data.version,
			server: `${data.server}`,
		};

		// 防止 UUID 过长
		if(inp.server.length > 22){
			socket.emit('msg', {type: 'errMsg', data: `不合理的 UUID: ${inp.server}`});
			return;
		}

		// 防止重复注册
		if(map.server[inp.server]){
			socket.emit('msg', {type: 'errMsg', data: `此节点已在线: ${inp.server}`});
			return;
		}

		logger.mark(`[Server] 注册服务端: Server[${inp.server}]`);

		// 记录服务端
		map.server[inp.server] = {
			ws: socket.id,
			ver: inp.version,
			list: {},
		};
		socket.ipac.type = 'SERVER';
		socket.ipac.server = inp.server;

		socket.emit('msg', {type: 'ServerReg', data: {success: true}});
	});


	// 服务端发送消息
	socket.on(`ServerSendSignal`, (data) => {
		const inp = {
			server: data.server,
			uuid: data.uuid,
			event: data.event,
			buf: data.buf,
		};
		// logger.info(`[Server] 发送信号: ${inp.server} -> ${inp.uuid}`);

		// 检查这个服务端是否记录
		if(map.server[inp.server] === undefined){
			socket.emit('msg', {type: 'errMsg', data: `服务端离线或不存在: Server[${inp.server}]`});
			return;
		}

		// 如果客户端不在这个服务端的注册列表中
		if(map.server[inp.server].list[inp.uuid] !== true){
			socket.emit('msg', {type: 'errMsg', data: `客户端离线或不存在: ${inp.uuid}`});
			return;
		}

		// 将信号转发给客户端
		io.to(map.client[inp.uuid].ws).emit('msg', {
			type: 'serverSignal',
			data: {event: inp.event, buf: inp.buf, uuid: inp.uuid},
		});
	});


	// 客户端注册事件
	socket.on(`ClientReg`, (data) => {
		const inp = {
			version: data.version,
			server: `${data.server}`,
			uuid: `${data.uuid}`,
		};

		// 防止 UUID 过长
		if(inp.uuid.length > 22){
			socket.emit('msg', {type: 'errMsg', data: `不合理的 UUID: ${inp.server}`});
			return;
		}

		// 是否存在这个服务端
		if(!map.server[inp.server]){
			socket.emit('msg', {type: 'errMsg', data: `服务端离线或不存在: Server[${inp.server}]`});
			return;
		}

		// 如果版本不匹配
		if(map.server[inp.server].ver !== inp.version){
			socket.emit('msg', {type: 'errMsg', data: `客户端版本不匹配: Client[${inp.version}] -> Server[${map.server[inp.server].ver}]`});
			return;
		}

		logger.mark(`[Client] 注册客户端: ${inp.uuid} -> Server[${inp.server}]`);

		// 记录客户端
		map.client[inp.uuid] = {
			ws: socket.id,
			server: inp.server,
		};
		socket.ipac.type = 'CLIENT';
		socket.ipac.server = inp.server;
		socket.ipac.uuid = inp.uuid;

		// 注册客户端到这个服务端下
		map.server[inp.server].list[inp.uuid] = true;

		// 向服务端发送客户端注册事件
		io.to(map.server[inp.server].ws).emit('msg', {type: 'client_registered', data: {uuid: inp.uuid, ip: socket.ipac.ip}});
		
		socket.emit('msg', {type: 'client_registered', data: {success: true}});
	});


	// 客户端发送消息
	socket.on(`ClientSendSignal`, (data) => {
		const inp = {
			server: data.server,
			uuid: data.uuid,
			event: data.event,
			buf: data.buf,
		};
		// logger.info(`[Client] 发送信号: ${inp.uuid} -> ${inp.server}`);

		// 检查这个服务端是否记录
		if(map.server[inp.server] === undefined){
			socket.emit('msg', {type: 'errMsg', data: `服务端离线或不存在: Server[${inp.server}]`});
			return;
		}

		// 如果客户端不在这个服务端的注册列表中
		if(map.server[inp.server].list[inp.uuid] !== true){
			socket.emit('msg', {type: 'errMsg', data: `客户端离线或不存在: ${inp.uuid}`});
			return;
		}

		// 将信号转发到服务端
		io.to(map.server[inp.server].ws).emit('msg', {
			type: 'clientSignal',
			data: {event: inp.event, buf: inp.buf, uuid: inp.uuid}
		});
	});


	socket.on('disconnect', () => {
		const inp = socket.ipac;
		logger.info(`[WS] 断开连接[${inp.ip}]: ${socket.id}`);

		// 清理产生的数据
		switch(inp.type){
			case 'CLIENT':
				// 向服务器发送客户端断开连接的消息
				if(map.server[inp.server]){
					io.to(map.server[inp.server].ws).emit('msg', {type: 'client_unregister', data: {uuid: inp.uuid}});
				}
				delete map.server[inp.server].list[inp.uuid];
				break;
			case 'SERVER':
				delete map.server[inp.server];
				break;
			default:
				break;
		};
	});
});

httpServer.listen(config.signal.port, () => {
	logger.mark(`服务端已启动, 监听端口 ${config.signal.port}`);
});

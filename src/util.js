import short from 'short-uuid';

export const sleep = (time) => new Promise((res) => setTimeout(res, time));

export const getUUID = () => short.generate(); // uuid v4

export const getIP = (req) => {
	// HTTP
	if(req.headers){
		req.headers['cf-connecting-ip'] || // CloudFlare
		req.headers['x-real-ip'] ||
		req.headers['x-forwarded-for'] ||
		req.ip
	}
	// Socket
	else{
		req.request.headers['cf-connecting-ip'] || // CloudFlare
		req.request.headers['x-real-ip'] ||
		req.request.headers['x-forwarded-for'] ||
		req.handshake.address
	}
};

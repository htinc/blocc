// Verbosity level
const VERBOSE = process.argv.indexOf("--verbose") == -1 ? 8 : process.argv[process.argv.indexOf("--verbose") + 1];
// 0 Show only status
// 5 Sync Info
// 7 Sync Requests
// 8 Show peer descovery
// 10 Show network traffic
// 20 Show single packages

process.on("unhandledRejection", r => console.log(r));

const BLOCC = (function (roots, address) {
	// libraries
	const smoke = require("smokesignal");
	const http = require("http");
	const os = require("os");
	
	// ports
	const port = 32445; // p2p port
	const privatePort = port + 1; // http-api port
	
	var public = {};
	
	// blockIds are separate bc not all blocks have to be synced
	var blockIds = [];
	const blocks = [];
	
	// list of known peer addresses
	const peers = [];

	// amount of chars in a block
	const blockSize = 200; //10000;
	
	// required amount of peers to verify a response
	const requiredSenders = 2;
	
	// blockrefs
	// the HEAD block is where new transactions get added to
	var HEAD = null;
	
	// the MINER block is the currently to be mined block
	var MINER = null;
	
	// logger
	var logLengths = {
		channel: 10,
		action: 20
	};
	
	function log(level, channel, action, color, message) {
		if (level <= VERBOSE) {
			if (channel.length > logLengths.channel) {
				logLengths.channel = channel.length;
			}
			
			if (action.length > logLengths.action) {
				logLengths.action = action.length;
			}
			
			if (channel.padEnd) {
				console.log("\u001b[38:5:" + color + "m[" + (channel + "] ").padEnd(logLengths.channel + 2) + action.padEnd(logLengths.action) + " ", message, "\u001b[0m");
			} else {
				console.log("\u001b[38:5:" + color + "m[" + channel + "]\t " + action + "\t ", message, "\u001b[0m");
			}
		}
	}
	
	// gets current ip address
	var ipAddress;
	var ifaces = os.networkInterfaces();

	for (var ifname in ifaces) {
		var alias = 0;
		
		ifaces[ifname].forEach(function (iface) {
			if ('IPv4' !== iface.family || iface.internal !== false) {
				return;
			}
			
			ipAddress = iface.address;
		});
	}
	
	// p2p node
	var node = smoke.createNode({
		port, 
		address: ipAddress,
		seeds: roots.map(ip => { 
			return {
				port,
				address: ip
			}
		}),
		minPeerNo: 25,
		maxPeerNo: 50
	});
	
	const p2p = {
		// p2p response functions
		hooks: {},
		
		// yells into the p2p room
		send(ob) {
			node.broadcast.write(JSON.stringify(ob));
		},
		
		// request data from the p2p network
		request(ob) {
			return new Promise(done => {
				// makes a private key for verification
				const privateKey = public.hash(Math.random() * 1000000, 16);
				const publicHash = public.hash(privateKey, 32);
				
				log(10, "network", "send request", 27, publicHash + ": " + JSON.stringify(ob, null, 4));
				
				var senders = 0;
				var datas = [];
				
				p2p.hooks[publicHash] = (data) => {
					senders++;
					
					// add peer if not already known
					if (peers.indexOf(data.from) == -1) {
						log(8, "peersearch", "found peer", 78, data.from);
						peers.push(data.from);
					}
					
					// enought answers returned
					if (senders == requiredSenders) {
						log(10, "network", "fix response", 63, publicHash + ": " + JSON.stringify(data.data, null, 4));
						
						// delete hook
						delete p2p.hooks[publicHash];
						
						done(data.data);
					}
				};
				
				// sends request package
				p2p.send({
					publicKey: publicHash,
					from: ipAddress,
					data: ob,
					type: "request"
				});
			});
		},
		
		// sends a response to a request to the p2p room
		response(request, ob) {
			log(10, "network", "send response", 26, request.publicKey + ": " + JSON.stringify(ob, null, 4));
			
			p2p.send({
				from: ipAddress,
				publicKey: request.publicKey,
				data: ob,
				type: "response"
			});
		},
		
		// login package
		hello() {
			return p2p.request({
				hello: true
			});
		},
		
		// add transaction request
		addTransaction(tx) {
			return p2p.request({
				addTransaction: tx
			});
		},
		
		// mining work submission
		minedBlock(flexsum, depth, address) {
			return p2p.request({
				minedBlock: {
					flexsum,
					address,
					depth
				}
			});
		}
	}
	
	// http / private server
	const net = {
		// request a single node (responsefragment)
		requestSingle(ip, path) {
			log(20, "pnetwork", "send requestf", 50, "#" + ip + ": /" + path.join("/"));
			return new Promise((done, fail) => {
				http.get({
					host: ip,
					port: privatePort,
					path: '/' + path.join("/")
				}, (response) => {
					var body = '';
					response.on('data', d => {
						body += d;
					});
					response.on('end', () => {
						try {
							var parsed = JSON.parse(body);
							log(20, "pnetwork", "got responsef", 49, "#" + ip + ": /" + path.join("/") + ": " + body);
						
							done(parsed);
						} catch (e) {
							// invalid data sent from peer
							log(0, "pnetwork", "malformed responsef", 1, "malformed data from #" + ip + " (/" + path.join("/") + "): '" + body + "' (error: " + e + ")");
							
							fail();
						}
					});
				});
			});
		},
		
		// request data (sends request to multiple nodes)
		request(path) {
			log(10, "pnetwork", "send request", 50, "/" + path.join("/"));
			return new Promise(done => {
				const responses = [];
				
				peers.forEach(p => {
					net.requestSingle(p, path).then(d => {
						responses.push(d);
						
						if (responses.length == requiredSenders) {
							log(10, "pnetwork", "got response", 49, "/" + path.join("/") + ": " + JSON.stringify(d, null, 4));
							done(d);
						}
					}).catch(() => {
						log(9, "pnetwork", "node might be outdated", 49, "/" + path.join("/") + ": " + p);
					});
				});
			});
		},
		
		// get block by id
		getBlock(id) {
			return net.request(["getBlock", id]);
		},
		
		// gets block ids
		getBlockIds() {
			return net.request(["getBlockIds"]);
		}
	}
	
	// p2p disconnection happens if the connected nodes go down
	node.on("disconnect", () => {
		log(0, "peer2peer", "disconnected", 1, "This might be a error");
	});
	
	// triggers when someone yells into the p2p room
	node.broadcast.on("data", ev => {
		const data = JSON.parse(ev.toString());
		
		if (data.publicKey) {
			if (p2p.hooks[data.publicKey] && data.type == "response") {
				// response from my request
				p2p.hooks[data.publicKey](data);
			} else if (data.type == "request") {
				const request = data.data;
				
				if (request.hello) {
					// hello package
					log(8, "peersearch", "new peer", 77, data.from);
					
					peers.push(data.from);
					
					p2p.response(data, {
						hi: true
					});
				} else if (request.minedBlock) {
					// proof mining work
					
					public.updateReferences();
					
					if (public.verifyBlock(request.minedBlock.flexsum, request.minedBlock.depth, request.minedBlock.address)) {
						console.log("\u001b[32mMINE WORK BY " + data.from + " VALID\u001b[0m");
						
						// set flexsum difficulty and miner of own MINER
						MINER.flexsum = request.minedBlock.flexsum;
						MINER.difficulty = request.minedBlock.depth;
						MINER.miner = request.minedBlock.address;
						
						// add last chain hash
						HEAD.last = public.hash(MINER);
						
						// update MINER and HEAD refs
						public.updateReferences();
					} else {
						console.warn("\u001b[31mMINE WORK BY " + data.from + " INVALID\u001b[0m");
					}
					
				} else if (request.addTransaction) {
					// add transaction to the HEAD block
					HEAD.transactions.push(request.addTransaction);
					
					const length = JSON.stringify(HEAD).length;
					
					log(5, "tx", "got", 37, request.addTransaction.from + " -> " + request.addTransaction.to + " " + request.addTransaction.value);
					log(3, "status", "current", 81, "txs (HEAD): " + length + "/" + blockSize + " miner done: " + (MINER == null));
					
					// fire event
					public.ontransaction(request.addTransaction.from, request.addTransaction.to, request.addTransaction.value, request.addTransaction.data);
					
					// check size and wait for MINER to complete
					if (length >= blockSize && (!MINER || process.argv.indexOf("--mine") != -1)) {
						p2p.response(data, true);
						
						// start mining
						if (process.argv.indexOf("--mine") != -1) {
							const depth = process.argv[process.argv.indexOf("--mine") + 1];
							const address = process.argv[process.argv.indexOf("--mine-wallet") + 1];
							
							public.updateReferences();
							
							console.log(depth, address, MINER);
							
							public.mineBlock(depth, address).then(flexsum => {
								p2p.minedBlock(flexsum, depth, address);
								
								public.downloadBlocks().then(() => {
									public.updateReferences();
								});
							});
						}
						
						// create next block
						public.nextBlock();
						
						return;  
					}
					
					public.updateReferences();
					
					p2p.response(data, false);
				} else {
					log(0, "peer2peer", "unexpected package", 1, JSON.stringify(data, null, 4));
				}
			} else if (data.type == "response") {
				
			} else {
				log(0, "peer2peer", "malformed package", 1, JSON.stringify(data, null, 4));
			}
		}
	});
	
	log(0, "pnetwork", "server started", 51, "http://" + ipAddress + ":" + privatePort);
	
	http.createServer(function (req, res) {
		const path = req.url.split("/").filter(a => a);
		
  		res.writeHead(200, {'Content-Type': 'application/json'});
		
		log("pnetwork", "got request", 51, path);
		
		if (path[0] == "getBlockIds") {
			res.end(JSON.stringify(blocks.map(b => b.id)));
		} else if (path[0] == "getBlock") {
			res.end(JSON.stringify(blocks.find(b => b.id == path[1])));
		} else {
			res.end(JSON.stringify({
				error: "Invalid path " + path
			}));
		}
	}).listen(privatePort);

	log(0, "peer2peer", "seed connecting", 99, roots.join(", "));
	
	function error(event) {
		console.error(event);
	}
	
	const dbName = "blocc";
	var db = null;
	
	public = {
		// event handlers
		ontransaction() {},
		onnextblock() {},
		
		start() {
			return new Promise(done => {
				node.start();
				
				log(0, "peer2peer", "server started", 99, "sig://" + ipAddress + ":" + port);
				
				node.on("connect", () => {
					log(0, "peer2peer", "seed connected", 99, node.peers.node.options.address);
					log(2, "peer2peer", "establishing links", 98, "");
					
					p2p.hello().then(() => {
						log(2, "peer2peer", "established links", 98, "");
						
						net.getBlockIds().then((bIds) => {
							blockIds = bIds;
							
							done();
						});
					});
				});
			});
		},
		
		// Basic HSUD hash algo (TODO: replace with Keccak-256)
		hash(ob, length) {
			if (!length) {
				length = 64;
			}
			
			var input = JSON.stringify(ob);
			var int = [73619, 501, 100517, 15027582, 103, 19947, 196571, 77291, 4719];
			
			input = input + int[4] + input; 
			
			for (var i = 1; i < input.length; i++) {
				var c = input.charCodeAt(i);
				for (var x = 1; x < int.length - 1; x++) {
					int[x] = ((c * int[x - 1]) % Math.floor(Math.sqrt(int[x + 1]) * length)) || int[5];
				}
			}
			
			for (var i = 0; i < length; i++) {
				int[i % int.length] += Math.ceil(Math.sqrt(int[(i + int[0]) % int.length])) + int[int.length - 1] || int[4];
			}
			
			var out = "";
			
			for (var i = 0; i < length; i++) {
				var c = (int[i % int.length] + i) % 16;
				out += String.fromCharCode(c + (c > 9 ? 87 : 48));
			}
			
			return out;
		},
		createWallet(password) {
			return new Promise(done => {
				const address = "0x" + public.hash(password + (new Date()), 20);
				
				done({
					address
				});
			});
		},
		genesis(init) {
			log(0, "genesis", "generating genesis", 28, "inithash: " + public.hash(init));
			
			blocks.push({
				id: "GENESIS",
				inithash: public.hash(init),
				last: public.hash(0),
				transactions: []
			});
			
			HEAD = blocks[0];
		},
		nextBlock() {
			log(1, "status", "next block", 29, "id: " + blocks.length);
			
			const block = {
				id: blocks.length,
				transactions: [],
				flexsum: ""
			};
			
			blocks.push(block);
			
			public.onnextblock(block);
			
			public.updateReferences();
		},
		mineBlock(depth, address) {
			return new Promise((done, err) => {
				MINER.last = blocks.filter(a => a.last).pop().last;
				
				console.log(blocks.filter(a => a.last).map(a => a.last));
				
				const headBlock = JSON.parse(JSON.stringify(MINER));
				
				headBlock.flexsum = Math.floor(Math.random() * 1000000000000);
				MINER.flexsum = null;
				
				const startSum = headBlock.flexsum;
				
				headBlock.difficulty = depth;
				MINER.difficulty = depth;
				headBlock.miner = address;
				MINER.miner = address;
				
				console.log("\u001b[33mmining", headBlock, " (" + MINER.id + ") with initial flexsum " + startSum);
				
				while (!public.nextMine(headBlock, "0".repeat(depth))) {}
				
				MINER.flexsum = headBlock.flexsum;
				
				console.log("mined", headBlock, "in " + (headBlock.flexsum - startSum) + " hashes\u001b[0m");

				// console.log(JSON.stringify(headBlock));
				// console.log(JSON.stringify(headBlock) == JSON.stringify(MINER));
				console.log(JSON.stringify(MINER));
				
				console.log("MINER", public.hash(MINER));
				console.log("HEAD", public.hash(HEAD));
				console.log("HEADBLOCK", public.hash(headBlock));
				
				done(headBlock.flexsum);
			});
		},
		nextMine(block, prefix) {
			block.flexsum++;
			return public.hash(block).startsWith(prefix);
		},
		verifyBlock(flexsum, depth, address) {
			if (!MINER) {
				console.warn("THERE IS NO MINER BLOCK", MINER);
				return;
			}
			
			const headBlock = JSON.parse(JSON.stringify(MINER));
			
			headBlock.flexsum = flexsum;
			headBlock.difficulty = depth;
			headBlock.miner = address;
			
			return public.hash(headBlock).startsWith("0".repeat(depth))
		},
		getBlock(id) {
			return new Promise(done => {
				done(blocks.find(b => b.id == id));
			});
		},
		send(from, to, value) {
			return new Promise((done, err) => {
				const tx = {
					value,
					from: from.address,
					to: to.address
				};
				
				HEAD.transactions.push(tx);
				
				p2p.addTransaction(tx).then(() => {
					public.updateReferences();
					done();
				});
			});
		},
		blocksMinedBy(address) {
			return new Promise(done => {
				const minedBlocks = [];
				
				for (var block of blocks) {
					if (block.miner == address) {
						minedBlocks.push(block);
					}
				}
				
				done(minedBlocks);
			});
		},
		transactionsOf(address) {
			return new Promise(done => {
				const transactions = [];
				
				for (var block of blocks) {
					for (var t of block.transactions) {
						if (t.from == address || t.to == address) {
							transactions.push(t);
						}
					}
				}
				
				done(transactions);
			});
		},
		balanceOf(address) {
			return new Promise(done => {
				var total = 0;
				
				public.blocksMinedBy(address).then(blocks => {
					for (var b of blocks) {
						total += b.difficulty * (b.transactions.length + 1);
					}
					
					public.transactionsOf(address).then(txs => {
						for (var t of txs) {
							if (t.from == address) {
								total -= t.value;
							} else {
								total += t.value;
							}
						}
						
						done(total);
					});
				});
			});
		},
		downloadBlocks() {
			blocks.splice(0, blocks.length);
			
			return new Promise(done => {
				public.downloadNextBlock(-1, () => {
					public.updateReferences();
					
					done();
				});
			});
		},
		downloadNextBlock(index, done) {
			index++;
			
			if (!blockIds[index]) {
				log(0, "blockdown", "done syncing blockchain", 71, blockIds);
				
				done();
				
				return;
			}
			
			log(7, "blockdown", "syncing", 70, blockIds[index] + " (" + index + ")/" + (blockIds.length - 1));
			
			public.downloadBlock(blockIds[index]).then(block => {
				log(5, "blockdown", "synched", 70, block.id);
				
				if (VERBOSE < 5) {
					process.stdout.write("[blockdown] synched " + blockIds[index] + " (" + index + ")/" + (blockIds.length - 1) + "  \r");
				}
				
				blocks.push(block);
				public.downloadNextBlock(index, done);
			});
		},
		downloadBlock(id) {
			return net.getBlock(id);
		},
		updateReferences() {
			HEAD = blocks[blocks.length - 1];
			MINER = blocks.find(b => !b.flexsum && JSON.stringify(b).length >= blockSize);
		},
		listBlockIds() {
			return blockIds;
		},
		listBlocks() {
			return blocks;
		},
		saveToDisk(file) {
			if (!HEAD) {
				return;
			}
			
			require("fs").writeFileSync(file || "blockchain.json", JSON.stringify({
				HEAD: HEAD.id,
				MINER: MINER ? MINER.id : null,
				blocks
			}));
		},
		stats() {
			console.log(HEAD);
			console.log(MINER);
			console.log("\n\n" + HEAD.transactions.length + "/" + blockSize);
			console.log(blocks.map(b => b.last));
		}
	};
	
	return public;
});

function log() {
	console.log("OUT ====>", arguments);
	
	return arguments[0];
}

var seeds = [
	"192.168.178.91"
];

try {
	seeds = JSON.parse(require("fs").readFileSync("peers.json"));
} catch (e) {}

blocc = BLOCC(seeds);

if (process.argv.indexOf("--genesis") != -1) {
	blocc.genesis(process.argv[process.argv.indexOf("--genesis") + 1]);
}

if (process.argv.indexOf("--monitor") != -1) {
	setInterval(() => {
		blocc.stats();
	}, 1000);
}

setInterval(() => {
	blocc.saveToDisk("blockchain.json");
}, 1000);

if (process.argv.indexOf("--app") != -1) {
	const app = require("./app.js");
	
	app(blocc);
}

blocc.start().then(() => {
	blocc.downloadBlocks().then(() => {
		blocc.createWallet("TESTPW123").then(wallet => {
			console.log("Wallet: ", wallet);
			
			/*if (process.argv.indexOf("--mine") != -1) {
				blocc.mine(process.argv[process.argv.indexOf("--mine") + 1]);
			}*/
			
			if (process.argv.indexOf("--send") != -1) {
				const max = +process.argv[process.argv.indexOf("--send") + 1];
				
				function send(i) {
					blocc.send(wallet, {
						address: "0x5555" + i
					}, Math.random()).then(() => {
						i++; 
						if (i < max) {
							process.stdout.write("[.] safe sent " + i + "/" + max + "  \r");
							send(i);
						}
					});
				}
				
				send(0);
			}
			
			if (process.argv.indexOf("--isend") != -1) {
				const max = +process.argv[process.argv.indexOf("--isend") + 1];
				
				for (var i = 0; i < max; i++) {
					blocc.send(wallet, {address: "0x5555" + i}, Math.random());
					process.stdout.write("[.] ignore sent " + i + "/" + max + "  \r");
				}
			}
		});
	});
});
	/*blocc.createWallet("TESTPW123").then(wallet => {
		blocc.getBlock(0).then(block => {
			log(JSON.stringify(block));
		});

		blocc.nextBlock().then(() => {
			
			log(wallet);
			
			blocc.getBlock(1).then(block => {
				log(JSON.stringify(block));
			});

			blocc.mineBlock(5, wallet).then(flexsum => {
				blocc.getBlock(1).then(block => {
					log(blocc.verifyBlock(block));

					blocc.nextBlock().then(() => {
						
						for (var i = 0; i < 10; i++) {
							blocc.send(wallet, {
								address: "0x5555"
							}, Math.random());
						}
						
						blocc.send(wallet, {
							address: "0x5555"
						}, 0.24).then(hash => {
							blocc.transactionsOf(wallet.address).then(txs => {
								blocc.blocksMinedBy(wallet.address).then(blocks => {
									blocc.balanceOf(wallet.address).then(amount => {
										log(amount);

										blocc.getBlock(2).then(block => {
											log(JSON.stringify(block));
											
											blocc.mineBlock(2, wallet).then(flexsum => {
												blocc.nextBlock().then(() => {
													blocc.balanceOf(wallet.address).then(amount => {
														console.log(amount);
													});
												});
											});
										});
									});
								});
							});
						});
					});
				});
			});
		});
	});
});




*/


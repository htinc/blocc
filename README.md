# blocc
The infinitely scaleable blockchain

## Time is always against you
Current blockchain implementations put transactions onto blocks that renew with a given interval. BitCoin and Ethereum aren't made for a real life environment where you'd have 15000 transactions per second (Thats what Visa currently processes). The BitCoin network is already at it's peak capacity. In our implementation, blocks are mined every time the block has reached it's maximum size. That makes our system infinitely scaleable

## IOT, Micro transactions, native Web integration — Why not
BLOCC still has miners (Unlike IOTA). But even tiny devices can make transactions or push any other kind of data. Websites can easily add data to the blockchain even from the frontend

Fees based on what you're doing, not others
Fees for BitCoin transaction are insanely high and we're not even using it on a real life scale. But these fees are based on the total activity of the network, not on what you actually do. With BLOCC your fees are determined by the size of your submitted data - and yes, you can store more then just transactions but we'll get to that later

## BLOCC Nodes
BLOCC has multiple different types of native nodes

### A Nodes
The A node is the normal Blockchain node. The current A node implementation is based on NodeJS. Every A node has a P2P channel (port 32445) for broadcast and a HTTP json API server for private communication (port 32446). The A nodes download all blocks to disk and send them to other A nodes

### B Nodes
The B node is for small devices, Websites and Wallets A B node talks to a set of known A nodes to commit transactions or to add other data to the blockchain. They perform HTTP requests. The B node is implemented in C++, Python and Javascript and can be easily ported to another language

### M Node
The M node is required to verify transactions. The M node is a extended version of the A node, but the miner itself is implemented in C. He is connected to other A nodes via P2P. The M node just downloads the top block and tries to find a hash with a given amount of zeros at the beginning. When a valid supplement has ben found, the M node will transmit his "flexsum" to the A and M nodes. They will then verify his action and give him a reward based upon the amount of zeros he found (16 ^ difficulty)

## Speed
We did a stress test on the network and it seems fucking fast. Committing 100 transactions (with awaiting of a response from at least 3 nodes) took about one second. We were able to send 100000 transactions to the network in 10 seconds

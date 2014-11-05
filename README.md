NR-XBeeAPI
=======

Node-RED module to support use of XBee wireless modules using xbee-api.

Based on Node-Red serial.js

Status:

Inbound and outbound messages working


Prerequisites
--------------
1. Node-RED's serial module must be enabled

2. Install xbee-api from npm

    $ npm install xbee-api


Example for sending a message to Xbee-api out node:

```
// See Xbee-API docs for API definitions
msg.payload = { 
				// Set type to frame_type string from xbee-api constants
				type: "REMOTE_AT_COMMAND_REQUEST",
		  		command: "D0",
		  		destination64: "0013A2004052989C",
    			remoteCommandOptions: 0x02, 
		  		commandParameter: [ ]
		}; 
return msg;
```

/**
* Heavily based on core\io\25-serial.js
*
* Copyright 2013,2014 IBM Corp.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
* http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
**/

module.exports = function(RED) {
    "use strict";
    var settings = RED.settings;
    var events = require("events");
    var util = require("util");
    var serialp = require("serialport");
    var bufMaxSize = 32768;  // Max serial buffer size, for inputs...
    var xbee_api = require("xbee-api");

    // TODO: 'xbeePool' should be encapsulated in SerialPortNode

    function XbeeAPINode(n) {
        RED.nodes.createNode(this,n);
        this.serialport = n.serialport;
        this.serialbaud = parseInt(n.serialbaud) || 9600;
    }
    RED.nodes.registerType("xbee-api",XbeeAPINode);

    function XbeeAPIOutNode(n) {
        RED.nodes.createNode(this,n);
        this.serial = n.serial;
        this.serialConfig = RED.nodes.getNode(this.serial);
        var C = xbee_api.constants;

        if (this.serialConfig) {
            var node = this;
            node.xbee = xbeePool.get(this.serialConfig.serialport,
                this.serialConfig.serialbaud
            );
            node.on("input",function(msg) {
                var addr = node.destination || msg.payload.destination64; // || 0013a20040aa18df  [0x00, 0x13, 0xa2, 0x00, 0x40, 0xaa, 0x18, 0xdf]
                if (addr) {
                    msg.payload.destination64 = addr;
                    var payload = msg.payload;
                    if (!Buffer.isBuffer(payload)) {
                        // not buffer so buildFrame
                        payload.type = C.FRAME_TYPE[payload.type];
                        payload = node.xbee.xbee.buildFrame(payload);
                        node.xbee.write(payload,function(err,res) {
                            if (err) {
                                node.error(err);
                            }
                        });
                    } else {
                        // send direct if we receive a buffer
                        node.xbee.write(payload, function(err, res) {
                            if (err) {
                                node.error(err);
                            }
                        })
                    }
                }
            });

            node.xbee.on('ready', function() {
                node.status({fill:"green",shape:"dot",text:"connected"});
            });
            node.xbee.on('closed', function() {
                node.status({fill:"red",shape:"ring",text:"not connected"});
            });
        } else {
            this.error("missing serial config");
        }

        this.on("close", function(done) {
            if (this.serialConfig) {
                xbeePool.close(this.serialConfig.serialport,done);
            } else {
                done();
            }
        });
    }
    RED.nodes.registerType("xbee-api out",XbeeAPIOutNode);


    function XbeeAPIInNode(n) {
        RED.nodes.createNode(this,n);
        this.serial = n.serial;
        this.serialConfig = RED.nodes.getNode(this.serial);
        this.xbee = n.xbee;

        if (this.serialConfig) {
            var node = this;
            node.tout = null;
            var buf;
            if (node.serialConfig.out != "count") { buf = new Buffer(bufMaxSize); }
            else { buf = new Buffer(Number(node.serialConfig.newline)); }
            node.status({fill:"grey",shape:"dot",text:"unknown"});
            node.xbee = xbeePool.get(this.serialConfig.serialport,
                this.serialConfig.serialbaud
            );

            this.xbee.on('data', function(msg) {
                var newMsg = { "source": msg.remote64, "payload": msg };
                node.send(newMsg);
            });

        } else {
            this.error("missing serial config");
        }

        this.on("close", function(done) {
            if (this.serialConfig) {
                xbeePool.close(this.serialConfig.serialport,done);
            } else {
                done();
            }
        });
    }
    RED.nodes.registerType("xbee-api in",XbeeAPIInNode);

    var xbeePool = function() {
        var connections = {};
        return {
            get:function(port,baud,callback) {
                var id = port;
                if (!connections[id]) {
                    connections[id] = function() {
                        var obj = {
                            _emitter: new events.EventEmitter(),
                            serial: null,
                            _closing: false,
                            tout: null,
                            xbee: null,
                            on: function(a,b) { this._emitter.on(a,b); },
                            close: function(cb) { this.serial.close(cb); },
                            write: function(m,cb) { this.serial.write(m,cb); }
                        }
                        var setupXbee = function() {
                                obj.xbee = new xbee_api.XBeeAPI({ 
                                    api_mode:2,
                                    module: "ZigBee"
                                });

                                obj.xbee.on('frame_object', function (frame) {
                                    obj._emitter.emit('data',frame);
                                });

                                obj.serial = new serialp.SerialPort(port,{
                                    baudrate: baud,
                                    parser: obj.xbee.rawParser()
                                },true, function(err, results) { if (err) { obj.serial.emit('error',err); } });

                            obj.serial.on('error', function(err) {
                                util.log("[xbee] serial port "+port+" error "+err);
                                obj._emitter.emit('closed');
                                obj.tout = setTimeout(function() {
                                    setupXbee();
                                }, settings.serialReconnectTime);
                            });
                            obj.serial.on('close', function() {
                                if (!obj._closing) {
                                    util.log("[xbee] serial port "+port+" closed unexpectedly");
                                    obj._emitter.emit('closed');
                                    obj.tout = setTimeout(function() {
                                        setupXbee();
                                    }, settings.serialReconnectTime);
                                }
                            });
                            obj.serial.on('open',function() {
                                util.log("[xbee] serial port "+port+" opened at "+baud+" baud ");
                                if (obj.tout) { clearTimeout(obj.tout); }
                                //obj.serial.flush();
                                obj._emitter.emit('ready');
                            });

                            obj.serial.on("disconnect",function() {
                                util.log("[xbee] serial port "+port+" disconnected");
                            });
                        }
                        setupXbee();
                        return obj;
                    }();
                }
                return connections[id];
            },
            close: function(port,done) {
                if (connections[port]) {
                    if (connections[port].tout != null) {
                        clearTimeout(connections[port].tout);
                    }
                    connections[port]._closing = true;
                    try {
                        connections[port].close(function() {
                            util.log("[xbee] serial port closed");
                            done();
                        });
                    }
                    catch(err) { }
                    delete connections[port];
                } else {
                    done();
                }
            }
        }
    }();

    RED.httpAdmin.get("/xbeeports",function(req,res) {
        serialp.list(function (err, ports) {
            res.writeHead(200, {'Content-Type': 'text/plain'});
            res.write(JSON.stringify(ports));
            res.end();
        });
    });
}

/**
 * Created by delian on 3/8/15.
 */

var net = require('net');
var debug = require('debug')('ciscoxml');
var util = require('util');
var clone = require('clone');

function Session(config) {
    if (!(this instanceof Session)) return new Session(config);

    var me = this;

    me.config = {
        host: '127.0.0.1',
        port: '38751',
        userPromptRegex: /(Username|Login)\:\s*/i,
        passPromptRegex: /Password\:\s*/i,
        xmlPromptRegex: /XML\>\s*/,
        authFailRegex: /Authentication Failed/i,
        username: 'guest',
        password: 'guest'
    };
    if (typeof config == 'object') util._extend(me.config,config);
    me.client = new net.Socket();
    me.connected = false;
    me.authenticated = false;
    me.buffer = "";
    me.rawQueue = []; // This queue contains the tasks we like to execute - data + callback for response
    me.rawQueueBlocked = false;

    me.client.on('end',function() {
        debug('Session ended');
        me.connected = false;
        me.authenticated = false;
    });

    return this;
}

/**
 * Connect to the remote site
 * @param config
 * @param cb
 */
Session.prototype.connect = function(config,callback) {
    var me = this;
    var cb = callback;
    if (typeof config == 'object') util._extend(me.config,config);
    if (typeof config == 'function') cb = config;
    debug('Trying to connect to %s:%s',me.config.host, me.config.port);
    me.client.on('error',function(err) {
        debug('Connect error %s',err);
        if (typeof cb == 'function') cb(err);
    });
    this.client.connect(
        me.config.port,
        me.config.host,
        function() {
            debug('Connected to %s:%s',me.config.host,me.config.port);
            me.connected = true;
            me.authenticated = false;
            me.client.on('data',function(data) {
                // We receive data
                me.buffer += data;
                if (!me.authenticated) {
                    // Check for authentication
                    // Check for Login: or Username: and send the username
                    // Check for Password: and send password
                    // Check for XML and terminate the authentication
                    debug('AUTH: >>> %s',me.buffer);
                    if (me.buffer.match(me.config.xmlPromptRegex)) {
                        me.authenticated = true;
                        me.buffer = "";
                        debug('AUTH: ---- Authentication successful!');
                        me.nextRawTask(); // Lets add the next task if it is waiting
                        if (typeof cb == 'function') return cb(null,me);
                        return; // Successful completion
                    } else {
                        if (me.buffer.match(me.config.userPromptRegex)) {
                            me.client.write(me.config.username+'\r\n');
                            me.buffer = "";
                            debug('AUTH: <<< %s',me.config.username);
                        }
                        if (me.buffer.match(me.config.passPromptRegex)) {
                            me.client.write(me.config.password+'\r\n');
                            me.buffer = "";
                            debug('AUTH: <<< %s',me.config.password);
                        }
                        if (me.buffer.match(me.config.authFailRegex)) {
                            debug('AUTH: !!!! Authentication failed!');
                            if (typeof cb == 'function') cb(new Error('Authentication Failed'));
                            return me.client.end(); // Fail
                        }
                    }
                    return;
                }

                if (me.buffer.match(me.config.xmlPromptRegex)) {
                    me.buffer = me.buffer.replace(me.config.xmlPromptRegex,'');
                }
                // We are authenticated and we receive data. Lets filter <Response ..>...</Response> and return it back to a CB queue
                if (me.buffer.match(/\<\/Response\>/i)) {
                    debug('RESPONSE: <<< %s',me.buffer);
                    if (me.rawQueueBlocked) {
                        if (typeof me.rawQueue[0].cb == 'function') me.rawQueue[0].cb(me.buffer);
                        me.popNextTask();
                    }
                    me.buffer = me.buffer.replace(/^[\s\S]*<\/Response\>/i,''); // Remove it from the buffer
                    //debug('TRIM: buffer left to be %s', me.buffer);
                }
            });
        }
    );
};

/**
 * Disconnect from the remote site
 * @param cb
 */
Session.prototype.disconnect = function(cb) {
    this.client.end();
    if (typeof cb == 'function') cb();
};

/**
 * Execute the next task if we are not waiting for response
 */
Session.prototype.nextRawTask = function() {
    if (!this.connected) return;
    if (!this.authenticated) return;
    if (this.rawQueueBlocked) return;
    if (this.rawQueue.length == 0) return;
    this.rawQueueBlocked = true;
    var data = this.rawQueue[0].data;
    if (!data.match(/\r\n$/)) data += '\r\n';
    this.client.write(data,function() {
        debug('QUEUE: >>> data sent to device %s',data);
    });
};

/**
 * Remove the top task blocked task
 */
Session.prototype.popNextTask = function() {
    if (!this.rawQueueBlocked) return;
    this.rawQueue.shift();
    this.rawQueueBlocked = false;
    this.nextRawTask();
};

Session.prototype.sendRaw = function(data,cb) {
    debug('QUEUE: New task has been add with %s',data);
    this.rawQueue.push({ data: data, cb: cb });
    this.nextRawTask();
};

module.exports = Session;

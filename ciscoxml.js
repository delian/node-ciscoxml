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

    me.client.on('end',function() {
        debug('Session ended');
        me.connected = false;
        me.authenticated = false;
    });

    return this;
}

Session.prototype.connect = function(config,cb) {
    var me = this;
    if (typeof config == 'object') util._extend(me.config,config);
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
                }
            });
        }
    );
};

module.exports = Session;

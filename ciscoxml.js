/**
 * Created by delian on 3/8/15.
 */

var net = require('net');
var debug = require('debug');

function Session(config) {
    if (!this instanceof Session) return new Session(config);

    this.config = config;
    this.client = new net.Socket();
    this.connected = false;
    this.authenticated = false;
    this.buffer = "";
}

Session.prototype.connect = function(config) {
    var me = this;
    this.client.connect(
        config.port || this.config.port || 38751,
        config.host || this.config.host || '127.0.0.1',
        function() {
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
                    if (me.buffer.match(/XML\>\s*/)) {
                        me.authenticated = true;
                        me.buffer = ""; // Should I do that?
                    } else {
                        if (me.buffer.match(/(Username|Login)\:\s*/i)) {
                            me.client.write(config.username+'\n');
                            me.buffer = "";
                        }
                        if (me.buffer.match(/Password\:\s*/i)) {
                            me.client.write(config.password+'\n');
                            me.buffer = "";
                        }
                    }
                }
            });
        }
    );
};

module.exports = Session;

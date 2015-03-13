/**
 * Created by delian on 3/8/15.
 */

var net = require('net');
var debug = require('debug')('ciscoxml');
var util = require('util');
var xml2js = require('xml2js');
var tls = require('tls');
//var clone = require('clone');

var xmlBuilder = new xml2js.Builder({ rootName: 'Request' });
var xmlParser = xml2js.parseString;

// TODO: Error handling and state cleaning when the TCP session is disconnected

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
        password: 'guest',
        connectErrCnt: 3,
        autoConnect: true,
        ssl: false,  // If present and it is an object, we assume it will contain the SSL options of the TLS module
        autoDisconnect: 60000,
        keepAlive: 30000,
        noDelay: true
    };
    if (typeof config == 'object') util._extend(me.config,config);
    me.client = false;
    me.connected = false;
    me.connecting = false;
    me.authenticated = false;
    me.buffer = "";
    me.autoDisconnectId = null;
    me.rawQueue = []; // This queue contains the tasks we like to execute - data + callback for response
    me.rawQueueBlocked = false;

    return this;
}


Session.prototype.js2xml = function(obj,cb) {
    var e;
    try {
        cb(null,xmlBuilder.buildObject(obj));
    } catch(e) {
        cb(e,null);
    }
};

Session.prototype.xml2js = xmlParser;

Session.prototype.objPretty = function(obj) {
    function pretty(o) {
        if (o instanceof Array) {
            for (var n=0;n<o.length;n++)
               if (typeof o[n] == 'string') {
                   if (/^\d+$/.test(o[n])) o[n]=parseInt(o[n]);
                   if (o[n]=='true' || o[n]=='false') o[n]=(o[n]=='true')?true:false;
               }
            return o.forEach(pretty);
        }
        if (typeof o == 'object') {
            Object.keys(o).forEach(function(n) {
                if (o[n] instanceof Array) {
                    if (o[n].length==1)
                        o[n] = o[n][0];
                    else
                        if (o[n].length==0) o[n] = '';
                }
                if (typeof o[n] == 'string') {
                    if (/^\d+$/.test(o[n])) o[n]=parseInt(o[n]);
                    if (o[n]=='true' || o[n]=='false') o[n]=(o[n]=='true')?true:false;
                }
                pretty(o[n]);
            });
        }
    }

    pretty(obj);

    return obj;
};

/**
 * This is a function that should be called when a session is terminated
 */
Session.prototype.onEnd = function() {
    debug('Session ended');
    var me = this;
    me.connected = false;
    me.authenticated = false;

    // Distribute errors if we have tasks waiting
    if (me.rawQueueBlocked) {
        debug('ERROR: Remote side disconnected, but we still wait for response');
        return me.errorRawTask(new Error('Remote side disconnected'));
    }

    if (me.rawQueue.length>0) { // This should never happen
        debug('WARN: Remote side disconnected, but we have tasks waiting');
        if (me.config.autoConnect) {
            debug('WARN: autoConnect is true. Reconnect');
            me.connect();
        }
    }
};

/**
 * Connect to the remote site
 * @param config
 * @param cb
 */
Session.prototype.connect = function(config,callback) {
    var me = this;
    var cb = function() {};
    if (typeof callback == 'function') cb = callback;
    if (typeof config == 'function') cb = config;
    if (typeof config == 'object') util._extend(me.config,config);
    debug('Trying to connect to %s:%s, SSL %s',me.config.host, me.config.port, me.config.ssl?'Yes':'No');

    if (me.config.connectErrCnt<=0) {
        debug('ERROR: We have no more right to retry!');
        return cb(new Error('No more connect retry!'));
    }

    if (me.connecting) return; // Connection is ongoing
    me.connecting = true;

    function connectProc() {
        debug('Connected to %s:%s',me.config.host,me.config.port);
        me.connected = true;
        me.authenticated = false;
        me.connecting = false;
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
                    if (cb) cb(null,me); // Start the callback once
                    cb = null; // Avoid double call of the callback
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
                        if (cb) cb(new Error('Authentication Failed'));
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
                me.popNextTask(me.buffer);
                me.buffer = me.buffer.replace(/^[\s\S]*<\/Response\>/i,''); // Remove it from the buffer
                //debug('TRIM: buffer left to be %s', me.buffer);
            }
            if (me.buffer.match(/\<\/Notification\>/i)) {
                debug('NOTIFICATION: <<< %s',me.buffer);
                me.notify(me.buffer);
                me.buffer = me.buffer.replace(/^[\s\S]*<\/Notification\>/i,'');
            }
        });
    }

    if (me.config.ssl) {
        me.client = tls.connect(
            me.config.port,
            me.config.host,
            typeof me.config.ssl == 'object'?me.config.ssl:{},
            function() {
                debug('SSL connected!');
                connectProc();
            }
        );
        me.client.setNoDelay(this.config.noDelay);
        me.client.setKeepAlive(this.config.keepAlive);
    } else {
        me.client = new net.Socket();
        me.client.setNoDelay(this.config.noDelay);
        me.client.setKeepAlive(this.config.keepAlive);
        me.client.connect(
            me.config.port,
            me.config.host,
            connectProc
        )
    }
    me.client.on('end',function() {
        me.onEnd();
    });
    me.client.on('error',function(err) {
        debug('ERROR: Connect error %s',err);
        if (cb) cb(err);
        me.errorRawTask(err);
        if (me.config.connectErrCnt>0) me.config.connectErrCnt--;
        me.connecting = false;
    });
};

/**
 * Disconnect from the remote site
 * @param cb
 */
Session.prototype.disconnect = function(callback) {
    var cb = function() {};
    if (typeof callback == 'function') cb = callback;
    if (this.config.connectErrCnt>0) this.config.connectErrCnt++; // to avoid normal decrease of the counter
    this.client.end();
    debug('SESSION disconnected');
    cb();
};

/**
 * Execute the next task if we are not waiting for response
 */
Session.prototype.nextRawTask = function() {
    var me = this;
    if (!(me.connected && me.authenticated)) {
        if (!me.config.autoConnect) return;
        debug('WARN: Next task is dispatched, but we are not yet connected. Connect...');
        return me.connect(); // Connect has automatic nextRawTask execution
    }
    if (me.rawQueueBlocked) return;
    if (me.rawQueue.length == 0) {
        // Execute autoDisconnect
        if (me.config.autoDisconnect && me.config.autoDisconnect>0) {
            if (me.autoDisconnectId) clearTimeout(me.autoDisconnectId);
            me.autoDisconnectId = setTimeout(function() {
                debug('WARN: Timeout expired with no new tasks. Autodisconnect');
                me.disconnect();
            },me.config.autoDisconnect);
            return;
        }
    }
    if (me.autoDisconnectId) clearTimeout(me.autoDisconnectId);
    me.rawQueueBlocked = true;
    var data = me.rawQueue[0].data;
    if (!data.match(/\r\n$/)) data += '\r\n';
    me.client.write(data,function() {
        debug('QUEUE: >>> data sent to device %s',data);
    });
};

/**
 * Remove the top task blocked task
 */
Session.prototype.popNextTask = function(data) {
    if (!this.rawQueueBlocked) return;
    if (typeof this.rawQueue[0].cb == 'function') this.rawQueue[0].cb(null,data);
    this.rawQueue.shift();
    this.rawQueueBlocked = false;
    this.nextRawTask();
};

/**
 * Sends raw data and expects callback
 * @param data
 * @param cb
 */
Session.prototype.sendRaw = function(data,callback,priority) {
    var cb = function() {};
    if (typeof callback == 'function') cb = callback;
    debug('QUEUE: New task has been add with %s and priority %s',data,priority?'first':'last');
    if ((!(this.connected && this.authenticated))&&(!this.config.autoConnect)) {
        debug('ERROR: new task has been dispatched, but we are not yet connected!');
        return cb(new Error('Not connected'));
    }
    if (priority)
        this.rawQueue.splice(this.rawQueueBlocked?1:0,0,{ data: data, cb: cb }); // The first possible execution
    else
        this.rawQueue.push({ data: data, cb: cb }); // Add it at the end
    this.nextRawTask();
};

/**
 * Discard all of the tasks in the raw queue
 */
Session.prototype.discardRawQueue = function() {
    if (this.rawQueue.length>0) debug('DISCARD %d raw tasks!',this.rawQueue.length);
    this.rawQueue = [];
    this.rawQueueBlocked = false;
};

/**
 * Notification
 * @param buffer
 */
Session.prototype.notify = function(buffer) {
    // TODO: Implement notification system
    debug('WARN: Notification code is not yet implemented!');
};

/**
 * Executes error to all waiting tasks in the raw queue
 * @param err
 */
Session.prototype.errorRawTask = function(err) {
    if (this.rawQueue.length>0) debug('Notify with error %d raw tasks!',this.rawQueue.length);
    this.rawQueue.forEach(function(q) {
        if (typeof q.cb == 'function') q.cb(err);
    });
    this.discardRawQueue();
};

// ------ XML ------

Session.prototype.sendRawObj = function(data,callback,priority) {
    var cb = function() {};
    if (typeof callback == 'function') cb = callback;
    if (typeof data != 'object') {
        debug('ERROR: We received request not in the right format! %s',data);
        return cb(new Error('Incorrect data'));
    }
    var me = this;
    if (typeof data['$'] == 'undefined') data['$'] = { MajorVersion: '1', MinorVersion: '0' };
    me.js2xml(data,function(err,data) {
        me.sendRaw(data,function (err,data) {
            if (err) return cb(err,data);
            me.xml2js(data,cb); // Now we could inherit the error from the XML parsing
        },priority);
    });
};

/**
 * Run GetNext request with IteratorID = id
 * @param id
 * @param cb
 */
Session.prototype.getNext = function(id,cb) {
    debug('Execute getNext request with id %s',id);
    return this.sendRawObj({ GetNext: { $: { IteratorID: id } } },cb,true);
};

/**
 * This is the same as sendRawObj but automatically handles getNext is it is present
 * @param data
 * @param cb
 * @returns {*}
 */
Session.prototype.sendRequest = function(data,callback) {
    var cb = function() {};
    if (typeof callback == 'function') cb=callback;
    if (typeof data != 'object') {
        debug('ERROR: We received request not in the right format! %s',data);
        cb(new Error('Incorrect data'));
        return;
    }
    var me = this;
    return me.sendRawObj(data,function(err,resp) {
        if (err) return cb(err,resp);
        // Test for Iterator
        if (resp && resp.Response && resp.Response['$']) {
            if (resp.Response['$'].IteratorID) {
                return me.getNext(resp.Response['$'].IteratorID,function(err,resp2) {
                    if (err) return cb(err,resp2);
                    cb(err,util._extend(resp,resp2)); // Merge the data
                },true); // Set it with priority
            }
        }
        cb(err,resp);
    });
};

// ------ Global Commands ------

Session.prototype.rootGetDataSpaceInfo = function(cb) {
    return this.sendRequest({ GetDataSpaceInfo: '' },cb);
};

Session.prototype.getConfig = function(p1,p2) {
    var cb = null;
    var req = {
        Get: {
            Configuration: ''
        }
    };

    if (typeof p1 == 'function') cb = p1;
    else if (p1) req.Get.Configuration = p1;

    if (typeof p2 == 'function') cb = p2;
    else if (p2) req.Get.Configuration = p2;

    return this.sendRequest(req,cb);
};

Session.prototype.getOper = function(p1,p2) {
    var cb = null;
    var req = {
        Get: {
            Operational: ''
        }
    };

    if (typeof p1 == 'function') cb = p1;
    else if (p1) req.Get.Operational = p1;

    if (typeof p2 == 'function') cb = p2;
    else if (p2) req.Get.Operational = p2;

    return this.sendRequest(req,cb);
};

/**
 * Expands path in a format similar to XPath
 * For example Hostname = <Hostname/>
 *
 * @param path
 */
Session.prototype.pathExpand = function (path) {

    function name(a) { // Returns only the name of the property
        return a.replace(/\(.*\)/g,'').replace(/\{.*\}/g,'').replace(/\=.*$/,'');
    }

    function attribs(a) { // Expands attributes and property
        var o = {};
        return o;
    }

    var obj = {};
    var o = obj;
    var a = path.split('.');
    for (var a = path.split('.'); a.length; o=o[name(a[0])]=attribs(a.shift()));
    return obj;
};

Session.prototype.pathExpandXml = function(path) {
    var data = this.pathExpand(path);
    if (typeof data['$'] == 'undefined') data['$'] = { MajorVersion: '1', MinorVersion: '0' };
    return xmlBuilder.buildObject(data);
};

Session.prototype.requestByPath = function(path,cb) {
    return this.sendRequest(this.pathExpand(path),cb);
};

Session.prototype.reqPathPath = function(path,p1,p2) {
    var cb = null;
    var filter = null;
    var me = this;
    if (p1 instanceof RegExp) filter = p1;
    if (p2 instanceof RegExp) filter = p2;
    if (typeof p1 == 'function') cb = p1;
    if (typeof p2 == 'function') cb = p2;
    return me.requestByPath(path,function(err,data) {
        if (err) {
            if (cb) cb(err,data);
            return;
        }
        //debug('We will execute callback %o',cb);
        //debug('We will search data with filter %o',filter);
        if (cb) cb(err,me.obj2path(data,filter))
    });
};

// CLI Exec
/**
 * Execute string command in a CLI config mode
 * @param cmd
 * @param cb
 * @returns {*}
 */
Session.prototype.cliConfig = function(cmd,cb) {
    return this.sendRequest({ CLI: { Configuration: cmd }},cb);
};

Session.prototype.cliExec = function(cmd,cb) {
    return this.sendRequest({ CLI: { Exec: cmd }},cb);
};

Session.prototype.commit = function(p1,p2) {
    var cb = null;
    var o = { Commit: {} };
    if (typeof p1 == 'object') o.Commit.$ = p1;
    if (typeof p2 == 'object') o.Commit.$ = p2;
    if (typeof p1 == 'function') cb = p1;
    if (typeof p2 == 'function') cb = p2;
    return this.sendRequest(o, cb);
};

Session.prototype.rollback = function(p1,p2) {
    var cb = null;
    var o = { Rollback: {} };
    if (typeof p1 == 'object') o.Rollback = p1;
    if (typeof p2 == 'object') o.Rollback = p2;
    if (typeof p1 == 'function') cb = p1;
    if (typeof p2 == 'function') cb = p2;
    return this.sendRequest(o, cb);
};

Session.prototype.alarmRegister = function(p1,p2) {
    var cb = null;
    var o = { Alarm: { Register: {} } };
    if (typeof p1 == 'object') o.Alarm.Register = p1;
    if (typeof p2 == 'object') o.Alarm.Register = p2;
    if (typeof p1 == 'function') cb = p1;
    if (typeof p2 == 'function') cb = p2;
    return this.sendRequest(o, cb);
};

Session.prototype.alarmDeRegister = function(p1,p2) {
    var cb = null;
    var o = { Alarm: { Register: {} } };
    if (typeof p1 == 'object') o.Alarm.Deregister = p1;
    if (typeof p2 == 'object') o.Alarm.Deregister = p2;
    if (typeof p1 == 'function') cb = p1;
    if (typeof p2 == 'function') cb = p2;
    return this.sendRequest(o, cb);
};


Session.prototype.getConfigurationHistory = function(p1,p2) {
    var cb = null;
    var o = { GetConfigurationHistory: {} };
    if (typeof p1 == 'object') o.GetConfigurationHistory.$ = p1;
    if (typeof p2 == 'object') o.GetConfigurationHistory.$ = p2;
    if (typeof p1 == 'function') cb = p1;
    if (typeof p2 == 'function') cb = p2;
    return this.sendRequest(o, cb);
};

Session.prototype.getConfigurationSessions = function(cb) {
    return this.sendRequest({ GetConfigurationSessions: {} }, cb);
};

Session.prototype.lock = function(cb) {
    return this.sendRequest({ Lock: {} }, cb);
};

Session.prototype.clear = function(cb) {
    return this.sendRequest({ Clear: {} }, cb);
};

Session.prototype.unlock = function(cb) {
    return this.sendRequest({ Unlock: {} }, cb);
};

/**
 * Converts obj to path and could apply a filter
 * @param obj
 * @param filter
 * @returns {Array}
 */
Session.prototype.obj2path = function(obj,filter) {
    var o = [];

    var f = filter instanceof RegExp;

    if (f) debug('OBJ2PATH conversion with filter %o',filter);

    function push(s,v) {
        if (f) {
            debug('OBJ2PATH test s:%s v:%s is %s',s,v,filter.test(s) || filter.test(v));
            if (filter.test(s) || filter.test(v)) return o.push([s,v]);
            return o;
        }
        return o.push([s,v]);
    }

    function trace(s,p) {
        if (p instanceof Array) {
            p.forEach(function(n) {
                trace(s,n);
            });
            return o;
        }

        if (typeof p == 'object') {
            if (typeof p['$'] == 'object') {
                // Lets extract the attributes
                s = s + '('+Object.keys(p['$']).map(function(n) { return '"'+n+'"="'+p['$'][n]+'"'; }).join(",")+')';
            }
            if (p['_']) {
                return push(s,p['_']);
            }

            var t = Object.keys(p).filter(function(n) { return n!='$' });
            if (t.length>0) return t.forEach(function(n) {
                if (s)
                    trace(s+'.'+n,p[n]);
                else
                    trace(n,p[n]);
            });
            return push(s,'');
        }

        return push(s,p);
    }

    trace('',obj);
    return o;
};

module.exports = Session;

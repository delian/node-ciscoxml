# Module for Cisco XML API interface IOS XR

This is a small module that implements interface to Cisco IOS XR XML Interface.

This module open an maintain TCP session to the router, sends requests and receive responses.

## Installation

To install the module do something like that:

    npm install node-ciscoxml

## Usage

It is very easy to use this module. See the methods bellow:

### Load the module

To load and use the module, you have to use a code similar to this:

    var cxml = require('node-ciscoxml');
    var c = cxml( { ...connect options.. });

### Module init and connect options

**host** (default 127.0.0.1) - the hostname of the router where we'll connect

**port** (default 38751) - the port of the router where XML API is listening

**username** (default guest) - the username used for authentication, if username is requested by the remote side

**password** (default guest) - the password used for authentication, if password is requested by the remote side

**connectErrCnt** (default 3) - how many times it will retry to connect in case of an error

**autoConnect** (default true) - should it try to auto connect to the remote side if a request is dispatched and there is no open session already

**autoDisconnect** (default 60000) - how much milliseconds we will wait for another request before the tcp session to the remote side is closed. If the value is 0, it will wait forever (or until the remote side disconnects). Bear in mind autoConnect set to false does not assume autoDisconnect set to 0/false as well.

**userPromptRegex** (default (Username|Login)) - the rule used to identify that the remote side requests for a username

**passPromptRegex** (default Password) - the rule used to identify that the remote side requests for a password

**xmlPromptRegex** (default XML>) - the rule used to identify successful login/connection

**noDelay** (default true) - disables the Nagle algorithm (true)

**keepAlive** (default 30000) - enabled or disables (value of 0) TCP keepalive for the socket

**ssl** (default false) - if it is set to true or an object, then SSL session will be opened. Node.js TLS module is used for that so if the ssl points to an object, the tls options are taken from it.
Be careful - enabling SSL does not change the default port from 38751 to 38752. You have to set it explicitly!

Example:

    var cxml = require('node-ciscoxml');
    var c = cxml( {
        host: '10.10.1.1',
        port: 5000,
        username: 'xmlapi',
        password: 'xmlpass'
    });

### connect method

This method forces explicitly a connection. It could accept any options of the above.

Example:

    var cxml = require('node-ciscoxml');
    var c = cxml();
    c.connect( {
        host: '10.10.1.1',
        port: 5000,
        username: 'xmlapi',
        password: 'xmlpass'
    });

The **connect** method is not necessary to be used. If autoConnect is enabled (default) the module will automatically open and close tcp connections when needed.

Connect supports callback. Example:

    var cxml = require('node-ciscoxml');
    cxml().connect( {
        host: '10.10.1.1',
        port: 5000,
        username: 'xmlapi',
        password: 'xmlpass'
    }, function(err) {
        if (!err)
            console.log('Successful connection');
    });

The callback may be the only parameter as well. Example:

    var cxml = require('node-ciscoxml');
    cxml({
        host: '10.10.1.1',
        port: 5000,
        username: 'xmlapi',
        password: 'xmlpass'
    }).connect(function(err) {
        if (!err)
            console.log('Successful connection');
    });

Example with SSL:

    var cxml = require('node-ciscoxml');
    var fs = require('fs');
    cxml({
        host: '10.10.1.1',
        port: 38752,
        username: 'xmlapi',
        password: 'xmlpass',
        ssl: {
              // These are necessary only if using the client certificate authentication
              key: fs.readFileSync('client-key.pem'),
              cert: fs.readFileSync('client-cert.pem'),
              // This is necessary only if the server uses the self-signed certificate
              ca: [ fs.readFileSync('server-cert.pem') ]
        }
    }).connect(function(err) {
        if (!err)
            console.log('Successful connection');
    });


### disconnect method

This method explicitly disconnects a connection.

### sendRaw method

.sendRaw(data,callback)

Parameters:

**data** - a string containing valid Cisco XML request to be sent

**callback** - function that will be called when a valid Cisco XML response is received

Example:

    var cxml = require('node-ciscoxml');
    var c = cxml({
        host: '10.10.1.1',
        port: 5000,
        username: 'xmlapi',
        password: 'xmlpass'
    });
    
    c.sendRaw('<Request><GetDataSpaceInfo/></Request>',function(err,data) {
        console.log('Received',err,data);
    });

### sendRawObj method

.sendRawObj(data,callback)

Parameters:

**data** - a javascript object that will be converted to a Cisco XML request

**callback** - function that will be called with valid Cisco XML response converted to javascript object

Example:

    var cxml = require('node-ciscoxml');
    var c = cxml({
        host: '10.10.1.1',
        port: 5000,
        username: 'xmlapi',
        password: 'xmlpass'
    });
    
    c.sendRawObj({ GetDataSpaceInfo: '' },function(err,data) {
        console.log('Received',err,data);
    });

### rootGetDataSpaceInfo method

.rootGetDataSpaceInfo(callback)

Equivalent to .sendRawObj for GetDataSpaceInfo command

### getNext

Sends getNext request with a specific id, so we can retrieve the rest of the previous operation if it has been truncated.

**id** - the ID
**callback** - the callback with the data (in js object format)

Keep in mind next response may be truncated as well, so you have to check for IteratorID all the time.

Example:

    var cxml = require('node-ciscoxml');
    var c = cxml({
        host: '10.10.1.1',
        port: 5000,
        username: 'xmlapi',
        password: 'xmlpass'
    });
    
    c.sendRawObj({ Get: { Configuration: {} } },function(err,data) {
        console.log('Received',err,data);
        if ((!err) && data && data.Response.$.IteratorID) {
            return c.getNext(data.Response.$.IteratorID,function(err,nextData) {
                // .. code to merge data with nextData
            });
        }
        // .. code
    });


### sendRequest method

This method is equivalent to sendRawObj but it can automatically detect the need and resupply GetNext requests so the response is absolutley full.
Therefore this method should be the preferred method for sending requests that expect very large replies.

Example:

    var cxml = require('node-ciscoxml');
    var c = cxml({
        host: '10.10.1.1',
        port: 5000,
        username: 'xmlapi',
        password: 'xmlpass'
    });
    
    c.sendRequest({ GetDataSpaceInfo: '' },function(err,data) {
        console.log('Received',err,data);
    });


### requestPath method

This is a method equivalent to sendRequest but instead of an object, the request may be formatted in a simple path string.
This metod is not very useful for complex requests. But its value is in the ability to simplify very much the simple requests.
The response is in JavaScript object

Example:

    var cxml = require('node-ciscoxml');
    var c = cxml({
        host: '10.10.1.1',
        port: 5000,
        username: 'xmlapi',
        password: 'xmlpass'
    });
    
    c.requestPath('Get.Configuration.Hostname',function(err,data) {
        console.log('Received',err,data);
    });


### reqPathPath method

This is the same method as requestPath, but the response is not an object, but a path array.
The method supports optional filter, which has to be a RegExp object and all paths and values will be tested against it
Only those returning true will be included in the response array.

Example:

    var cxml = require('node-ciscoxml');
    var c = cxml({
        host: '10.10.1.1',
        port: 5000,
        username: 'xmlapi',
        password: 'xmlpass'
    });
    
    c.reqPathPath('Get.Configuration.Hostname',/Hostname/,function(err,data) {
        console.log('Received',data[0]);
        // The output should be something like
        // [ 'Response("MajorVersion"="1","MinorVersion"="0").Get.Configuration.Hostname("MajorVersion"="1","MinorVersion"="0")',
               'asr9k-router' ] 
    });

This method could be very useful for getting simple responses and configurations.

### getConfig method

This method requests the whole configuration of the remote device and return it as object

Example:

    c.getConfig(function(err,config) {
        console.log(err,config);
    });

### cliConfig method

This method is quite simple, it executes a command(s) in CLI Configuration mode and return the response in JS Object.
You have to know that any configuration change in IOS XR is not effective unless it is committed!

Example:

    c.cliConfig('username testuser\ngroup operator\n',function(err,data) {
        console.log(err,data);
        c.commit();
    });

### cliExec method

Executes a command(s) in CLI Exec mode and return the response in JS Object.

    c.cliExec('show interfaces',function(err,data) {
        console.log(err,data?data.Response.CLI[0].Exec[0]);
    });

### commit method

Commit the current configuration.

Example:

    c.commit(function(err,data) {
        console.log(err,data);
    });

It supports optional object to set the commit mode. For example:

    c.commit({ Mode: "Atomic" },function(err,data) {
        console.log(err,data);
    });

### rollback method

Rollbacks the current configuration

Example:

    c.rollback({ CommitID: '1212121' },function(err,data) {
        console.log(err,data);
    });

### getConfigurationSessions method

Report the current configuration sessions

Example:

    c.getConfigurationSessions(function(err,data) {
        console.log(err,data);
    });

### clear method

Equivalent to Cisco clear command.

Example:

    c.clear(function(err,data) {
        console.log(err,data);
    });

### lock method

Locks the configuration mode.

Example:

    c.lock(function(err,data) {
        console.log(err,data);
    });

### unlock method

Unlocks, abort and exit the configuration mode.

Example:

    c.unlock(function(err,data) {
        console.log(err,data);
    });

### abort method

abort method is juct linked to the unlock method in Cisco IOS XML API

## Configure Cisco IOS XR for XML agent

To configure IOS XR for remote XML configuration you have to:

*Ensure you have **mgbl*** package installed and activated! Without it you will have no **xml agent** commands!

Enable the XML agent with a similar configuration:

    xml agent
      vrf default
        ipv4 access-list SECUREACCESS
      !
      ipv6 enable
      session timeout 10
      iteration on size 100000
    !

You can enable tty and/or ssl agents as well!

(Keep in mind - full filtering of the XML access has to be done by the **control-plane management-plane** command! The XML interface does not use VTYs!)

You have to ensure you have correctly configured **aaa** as the xml agent uses **default** method for both authentication and authorization and that cannot be changed (last verified with IOS XR 5.3).

You have to have both aaa authentication and authorization. If authorization is not set (**aaa authorization default local** or **none**), you may not be able to log in. And you shall ensure that both the authentication and authorization share the same source (tacacs+ or local).

The default agent port is 38751 for the default agent and 38752 for SSL.

## Debugging

The module uses "debug" module to log its outputs. You can enable the debugging by having in your code something like:

    require('debug').enable('ciscoxml');

Or setting DEBUG environment to ciscoxml before starting the Node.JS

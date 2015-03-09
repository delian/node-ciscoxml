# Module for Cisco XML API interface IOS XR

This is a small module that implements interface to Cisco IOS XR XML Interface.

This module open an maintain TCP session to the router, sends requests and receive responses.

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


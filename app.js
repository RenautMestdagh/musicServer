const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('cookie-session');
const logger = require('morgan');
const fs = require("fs");
require('dotenv').config()

const app = express();

const server = require('http').Server(app);
let httpsServer
// if (process.env.NODE_ENV === "production"){
//     //Certificate
//     const cert_path='/etc/letsencrypt/live/renautmusic.ml/'
//     const privateKey = fs.readFileSync(cert_path+'privkey.pem', 'utf8');
//     const certificate = fs.readFileSync(cert_path+'cert.pem', 'utf8');
//     const ca = fs.readFileSync(cert_path+'chain.pem', 'utf8');
//
//     const credentials = {
//         key: privateKey,
//         cert: certificate,
//         ca: ca
//     };
//     httpsServer = require('https').createServer(credentials, app);
// }

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

// http -> https
app.enable('trust proxy');
// app.use(function (req, res, next) {
//     if (req.app.get('env') === "production")
//         req.secure ? next() : res.redirect('https://' + req.headers.host + req.url)
//     else
//         next();
// })

// www. X
app.get( '/*', function(req, res, next){
    if (req.headers.host.match(/^www\./))
        return res.redirect("http"+/*s*/+"://"+req.headers.host.substring(4) + req.url)
    else
        next()
})

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(
    session({
        resave: false,
        saveUninitialized: false,
        secret: 'y&yR2q43rYz##4Z5',
    })
)

app.use('/login', require('./routes/login'));
app.use(function(req, res, next){

    if (!req.session.userId) {
        if(req.method==='POST')
            return res.send('noSession')
        return res.redirect('/login')
    }
    next()
})

app.use('/', require('./routes/index'));

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    // render the error page
    res.status(err.status || 500);
    res.render('error');
});

module.exports = {app: app, server: server, httpsServer: httpsServer};

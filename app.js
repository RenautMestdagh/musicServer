const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('cookie-session');
const logger = require('morgan');
require('dotenv').config()
const router = express.Router();

const app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.use("/ytconfig",express.static(path.join(__dirname, 'public')));
app.use(
    session({
        resave: false,
        saveUninitialized: false,
        secret: 'y&yR2q43rYz##4Z5',
    })
)

router.use(function(req, res, next){

    if (!req.session.userId && req.url!=="/login") {
        if(req.method==='POST')
            return res.send('noSession')
        return res.redirect('/ytconfig/login')
    }
    next()
})

router.use('/login', require('./routes/login'));

router.use('/', require('./routes/index'));

app.use("/ytconfig", router)

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    next(createError(404));
});

// error handler
app.use(function(err, req, res) {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    // render the error page
    res.status(err.status || 500);
    res.render('error');
});

module.exports = app;

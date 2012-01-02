/* VALIDATION.JS
 * TODO FOR RELEASE:
 * - nothing
 */
var conf = require('./conf'),
	Recaptcha = require('recaptcha').Recaptcha,
	app = require('./app').app,
	ldap = require('./openmrsid-ldap'),
	log = require('./logger').add('validation');

module.exports = function(redirect) {
	return function(req, res, next) {
		if (req.body) {
			var b = req.body, user = req.session.user, calls = 1, called = 0, reachedEnd, failures = {}, failed = false, values = {}, failReason = {};
			function fail(field, reason, idx) {
				failed = true;
				
				if (typeof idx == 'number') {
					if (!failures[field]) failures[field] = new Array;
					failures[field][idx] = true;
				}
				else failures[field] = true;
				
				if (reason) failReason[field] = reason;
				
				log.debug('validation error in '+field);
			}
			function empty(field) {
				if (!b[field]) {
					fail(field);
					return false;
				}
				else return true;
			}
			function unique(field) {
				for (otherField in b) {
					if (b[field] == b[otherField]) return false;
				}
				return true;
			}
			function finish() {
				called++;
				if (called == calls && reachedEnd) {
					app.helpers({failed: true, values: values, fail: failures, failReason: failReason});
					if (failed == true) {
						if (redirect) return res.redirect(redirect);
						else return res.redirect(req.url);
					}
					else return next();
				}
			}
			
			for (field in req.body) {
				values[field] = b[field];
				
				// only validate if field has been changed OR if field is not part of user (such as recaptcha validation)
				if (!user || !user[conf.user[field]] || (user[conf.user[field]] && b[field] != user[conf.user[field]])) {
				
					if (field == 'username')
						if (empty(field) && !conf.user.usernameRegex.exec(b[field])) fail(field);
					if (field == 'email')
						if (empty(field) && !conf.email.validation.emailRegex.test(b[field])) fail(field);
						else if (conf.email.validation.forceUniquePrimaryEmail) {
							calls++;
							var thisField = field;
							ldap.getUserByEmail(b[field], function(e, obj){
								if (obj) if(!user || (user && user.dn != obj.dn)) fail(thisField, 'This email address is already registered. A unique email address must be provided.');
								finish();
							});
						}
					if (field == 'secondaryemail') {
						// treat a single secondary-email list as multiple to keep validation DRY
						if (typeof b[field] == 'string') {
							b[field] = [b[field]];
							values[field] = [b[field]];
						}
						
						// perform validation
						for (var i=0; i<b[field].length; i++) {
							if (!b[field][i]) b[field].splice(i, 1); // delete any empty cells
							else {
								if ((!conf.email.validation.emailRegex.test(b[field][i]))) fail(field, undefined, i); // ensure the text entered is an email address
							
								if (conf.email.validation.forceUniqueSecondaryEmail) { // ensure address is unique
									calls++;
									var thisField = field;
									ldap.getUserByEmail(b[field][i], function(e, obj, call){
										if (obj) fail(thisField, 'This email address is already registered. A unique email address must be provided.', b[thisField].indexOf(call));
										finish();
									});
								}
							}
						}
					}
					if (field == 'password' || field == 'newpassword')
						if (b[field].length < 8) fail(field);
					if (field == 'confirmpassword')
						if (b['newpassword'] != b[field]) fail(field);
					if (field == 'currentpassword') {
						var currentField = field;
						calls++;
						ldap.authenticate(user[conf.user.username], b[field], function(e){
							ldap.close(user[conf.user.username]);
							if (e) if (e.message == '49' || e.message == '34' || e.message == '53') // login failed
								fail(currentField, 'Authentication failed.');
							finish();
						});
					}
					if (field == 'recaptcha_response_field') {
						calls++; // need to wait on a callback
						var captchaData = {
							remoteip:  req.connection.remoteAddress,
							challenge: req.body.recaptcha_challenge_field,
							response:  req.body.recaptcha_response_field
						}, recaptcha = new Recaptcha(conf.validation.recaptchaPublic, conf.validation.recaptchaPrivate, captchaData);
						
					    recaptcha.verify(function(success, error_code) {
					    	finish();
					        if (!success) fail(field);
					    });
					}
					if (field == 'firstname' || field == 'lastname' || field == 'loginusername' || field == 'loginpassword')
						empty(field);
				}
			}
			reachedEnd = true;
			finish();
		}
		else next();
	}
};
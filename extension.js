const impl = require('./main_scripts/extension-impl');

module.exports = {
    activate: impl.activate,
    deactivate: impl.deactivate
};

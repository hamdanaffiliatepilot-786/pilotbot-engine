function env(key) {
    let val = process.env[key];
    if (!val) return '';
    return val.replace(/^['"\s]+|['"\s]+$/g, '').trim();
}

function envBool(key, fallback = false) {
    const val = env(key).toLowerCase();
    if (val === 'true' || val === '1') return true;
    if (val === 'false' || val === '0') return false;
    return fallback;
}

function envInt(key, fallback = 0) {
    const val = parseInt(env(key), 10);
    return isNaN(val) ? fallback : val;
}

module.exports = { env, envBool, envInt };

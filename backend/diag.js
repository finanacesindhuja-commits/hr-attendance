const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const dotenv = require('dotenv');

try {
    const envConfig = dotenv.parse(fs.readFileSync('.env'));
    const supabaseUrl = envConfig.SUPABASE_URL;
    const supabaseKey = envConfig.SUPABASE_SERVICE_ROLE_KEY;

    console.log('URL:', supabaseUrl);
    // Hide most of the key but show start/end for verification
    console.log('Key:', supabaseKey.substring(0, 10) + '...' + supabaseKey.substring(supabaseKey.length - 10));

    const supabase = createClient(supabaseUrl, supabaseKey);

    async function check() {
        console.log('Checking "staff" table...');
        const { data: staff, error: staffError } = await supabase.from('staff').select('count', { count: 'exact' });
        if (staffError) {
            console.error('❌ Staff Error:', staffError.message);
        } else {
            console.log('✅ Staff Table OK. Count:', staff);
        }

        console.log('Checking "staff_leaves" table...');
        const { data: leaves, error: leavesError } = await supabase.from('staff_leaves').select('count', { count: 'exact' });
        if (leavesError) {
            console.error('❌ Leaves Error:', leavesError.message);
        } else {
            console.log('✅ Leaves Table OK.');
        }
    }
    check();
} catch(e) {
    console.error('FATAL:', e.message);
}

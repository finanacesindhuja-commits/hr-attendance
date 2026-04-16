const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './backend/.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTable() {
    console.log('Checking if staff_leaves table exists...');
    const { data, error } = await supabase
        .from('staff_leaves')
        .select('*', { count: 'exact', head: true });

    if (error) {
        console.error('❌ Error:', error.message);
        if (error.message.includes('relation "public.staff_leaves" does not exist')) {
            console.log('⚠️ TABLE MISSING: Use the SQL editor in Supabase to create the table.');
        }
    } else {
        console.log('✅ Success: Table exists.');
    }
}

checkTable();

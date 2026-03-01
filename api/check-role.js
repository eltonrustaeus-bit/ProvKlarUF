import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req,res){

if(req.method !== "POST"){
return res.status(405).json({error:"Method not allowed"});
}

try{

const {user_id} = req.body;

const {data,error} = await supabase
.from("user_roles")
.select("role")
.eq("user_id",user_id)
.single();

if(error || !data){
return res.status(200).json({
role:"basic"
});
}

return res.status(200).json({
role:data.role
});

}
catch(e){

return res.status(500).json({
error:String(e)
});

}

}

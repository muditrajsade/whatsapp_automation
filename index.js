import express from "express";
import Redis from "ioredis";
import dotenv from "dotenv";
import twilio from "twilio";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import bodyParser from "body-parser";

dotenv.config();

const app = express();
app.use(express.json());
const PORT = 3000;
app.use(bodyParser.urlencoded({ extended: false }));
// --------------------
// REDIS
// --------------------
const redis = new Redis({ host: 'redis-14570.c16.us-east-1-3.ec2.cloud.redislabs.com', port: 14570, password: 'Fi15eZuzWjksQwtIKCWExFknNJAFvoG8' });

redis.on("connect", () => console.log("Connected to Redis"));
redis.on("error", err => console.error("Redis error:", err));

// --------------------
// OPENAI
// --------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// --------------------
// TWILIO
// --------------------
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);



// --------------------
// PINECONE
// --------------------
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});

const pineconeIndex = pinecone.Index(
  process.env.PINECONE_INDEX_NAME
);

// --------------------
// HELPERS
// --------------------
async function embedText(text) {
  const embedding = await openai.embeddings.create({
    model: "text-embedding-3-large",
    input: text
  });
  return embedding.data[0].embedding;
}

function normalizePropertyName(text) {
  const t = text.toLowerCase();
  if (t.includes("elara")) return "L&T ELARA CELESTIA";
  if (t.includes("godrej") && t.includes("yelahanka")) return "GODREJ YELAHANKA";
  return null;
}

async function getActiveProperty(from) {
  const key = `state:${from}`;
  const val = await redis.get(key);
  return val ? JSON.parse(val).active_property : null;
}

async function setActiveProperty(from, propertyName) {
  const key = `state:${from}`;
  await redis.set(
    key,
    JSON.stringify({ active_property: propertyName })
  );
}

async function summarizeForWhatsApp(text) {
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Summarize for WhatsApp under 1200 chars." },
      { role: "user", content: text }
    ]
  });
  return resp.choices[0].message.content.trim();
}
import pkg from "pg";

const { Pool } = pkg;

const pool = new Pool({ connectionString: 'postgresql://neondb_owner:npg_jRYecChOua13@ep-twilight-morning-a4nqbqdi-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require', ssl: { rejectUnauthorized: false } }); const test = async () => { const res = await pool.query('SELECT NOW()'); console.log('Neon connected at:', res.rows[0].now); }; test();

// --------------------
// MAIN WEBHOOK
// --------------------
app.post("/", async (req, res) => {
  try {
    const payload = req.body.body;
    const from = payload.From;
    const to = payload.To;
    const userMessage = payload.Body;

    // --------------------
    // LOAD CONVERSATION
    // --------------------
    const conversationKey = `conversation:${from}`;
    let conversation = await redis.get(conversationKey);
    conversation = conversation ? JSON.parse(conversation) : [];

    conversation.push({
      role: "user",
      message: userMessage,
      timestamp: new Date().toISOString()
    });

    // --------------------
    // PROPERTY STATE (SOURCE OF TRUTH)
    // --------------------
    let activeProperty = await getActiveProperty(from);

    const detectedProperty = normalizePropertyName(userMessage);
    if (detectedProperty) {
      activeProperty = detectedProperty;
      await setActiveProperty(from, detectedProperty);
    }

    // --------------------
    // 🔒 PROPERTY-LOCKED SEMANTIC QUERY
    // --------------------
    let semanticQuery;
    let topK = 7;

    if (activeProperty) {
      // STRICT LOCK: retrieve ONLY this property's chunks
      semanticQuery = activeProperty;
    } else {
      // No property context yet
      semanticQuery = userMessage;
    }

    // --------------------
    // VECTOR SEARCH
    // --------------------
    const vectorResult = await pineconeIndex.query({
      vector: await embedText(semanticQuery),
      topK,
      includeMetadata: true
    });

    if (!vectorResult.matches.length) {
      await twilioClient.messages.create({
        from: to,
        to: from,
        body: "Could you please tell me which property you are referring to?"
      });
      return res.status(200).send("Clarification requested");
    }

    // --------------------
    // COMBINE ALL PROPERTY CHUNKS
    // --------------------
    const retrievedContext = vectorResult.matches
      .map(m => m.metadata.text)
      .join("\n\n");

    // --------------------
    // FINAL ANSWER PROMPT
    // --------------------
    const finalAnswerPrompt = `
You are a real estate assistant.

Answer ONLY using the context below.
Do NOT use outside knowledge.
If something is not available, say so clearly.
If a configuration is not offered, mention what IS offered.

CONTEXT:
${retrievedContext}

USER QUESTION:
${userMessage}
`;

    const answerResp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You answer real estate questions accurately." },
        { role: "user", content: finalAnswerPrompt }
      ]
    });

    let finalReply = answerResp.choices[0].message.content.trim();

    // --------------------
    // WHATSAPP SAFETY
    // --------------------
    if (finalReply.length > 1200) {
      finalReply = await summarizeForWhatsApp(finalReply);
    }

    // --------------------
    // SAVE & SEND
    // --------------------
    conversation.push({
      role: "bot",
      message: finalReply,
      timestamp: new Date().toISOString()
    });

    await redis.set(conversationKey, JSON.stringify(conversation));

    await twilioClient.messages.create({
      from: to,
      to: from,
      body: finalReply
    });

    res.status(200).send("Message processed successfully");

  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).send("Internal Server Error");
  }
});



async function temp(req){

    let a = await redis.hexists("whatsapp",req.body.From);
  if(a == 1){

    console.log(req.body);

    
    let fcx = await redis.hget("whatsapp",req.body.From);
    fcx = Number(fcx) || 0;
    await redis.hset("whatsapp",req.body.From,fcx+1);
    

    if(fcx+1 == 1){
      await redis.hset("prop",req.body.From,req.body.ListTitle);
const message = await twilioClient.messages.create({
    from: req.body.To,   // your Twilio WhatsApp number
    to: req.body.From,     // user number
    contentSid: "HX975b0eabae16a31ddf0f60b7997f301a"
  });





    }
    else if(fcx+1 == 2){
      await redis.hset("budget",req.body.From,req.body.ListId);
      const message = await twilioClient.messages.create({
    from: req.body.To,   // your Twilio WhatsApp number
    to: req.body.From,     // user number
    contentSid: "HXe52c32fdf2eb984c5a0bacb3e199053d"
  });





    }
    else if(fcx+1 == 3){
      
      let rg = req.body.ListId;

      let locationType = await redis.hget("prop",req.body.From);
      let rdwq = await redis.hget("budget",req.body.From);

      

      let bhk = "";

      if(rg == '1_bhk'){
        bhk = "1 BHK";
      }
      else if(rg == '2_bhk'){
        bhk = "2 BHK";
      }

      else if(rg == '2.5_bhk'){
        bhk = "2.5 BHK";
      }

      else if(rg == '3_bhk'){
        bhk = "3 BHK";

      }
      else if(rg == '3_5_bhk'){
        bhk = "3.5 BHK";
      }
      else if(rg == '4_bhk'){
        bhk = "4 BHK";
      }
      else if(rg == '5_bhk'){
        bhk = "5 BHK";
      }

      if(bhk == ""){

        bhk = await redis.hget("room",req.body.From);

      }
      else{

        await redis.hset("room",req.body.From,bhk);

      }

      

      let minPrice = 0;
      let maxPrice = 0;
      if(rdwq == 'a'){
        minPrice = 10000000;
        maxPrice = 30000000;

      }
      else if(rdwq == 'b'){
        minPrice=30000000;
        maxPrice=50000000;
      }
      else if(rdwq == 'c'){
        minPrice = 50000000;
        maxPrice = 80000000;
      }
      else if(rdwq == 'd'){
        minPrice = 80000000;
        maxPrice = 150000000;
      }

      let query = `
    SELECT DISTINCT property_name
    FROM properties
    WHERE bhk_type = $1
      AND price < $3
      AND location_type = $4
  `;

  let result = null;

  if(locationType == "open to any location"){

    query = `
    SELECT DISTINCT property_name
    FROM properties
    WHERE bhk_type = $1
      AND price < $2
  `;

   const values = [bhk, maxPrice];

      result = await pool.query(query, values);

  }
  else{

    query = `
    SELECT DISTINCT property_name
    FROM properties
    WHERE bhk_type = $1
      AND price < $2
      AND location_type = $3
  `;

   const values = [bhk, maxPrice, locationType];

      result = await pool.query(query, values);

  }

     

      let properties = result.rows;

      let vars = {};

      if(properties.length == 0){

        await hset("whatsapp",req.body.From,7);

        await twilioClient.messages.create({
  from: req.body.To,
  to: req.body.From,
  contentSid: "HX29827a6a4b87a1e55333d3e7b0176416"
});

      }

      if(properties.length == 1){
        



for (let i = 0; i < 1; i++) {
  vars[String(i + 1)] = properties[i]?.property_name ?? "";
}


console.log(vars);
await twilioClient.messages.create({
  from: req.body.To,
  to: req.body.From,
  contentSid: "HX9508bc7462f10c5a517868aae5fc626e",
  contentVariables: JSON.stringify(vars)
});
      }
      else if(properties.length == 2){

        for (let i = 0; i < 2; i++) {
  vars[String(i + 1)] = properties[i]?.property_name ?? "";
}


console.log(vars);
await twilioClient.messages.create({
  from: req.body.To,
  to: req.body.From,
  contentSid: "HX499a1e00a3aa84eaf2b7e844d87521c7",
  contentVariables: JSON.stringify(vars)
});

      }

      else if(properties.length == 3){
         for (let i = 0; i < 3; i++) {
  vars[String(i + 1)] = properties[i]?.property_name ?? "";
}


console.log(vars);
await twilioClient.messages.create({
  from: req.body.To,
  to: req.body.From,
  contentSid: "HXb662d665978c104f2e08a452496d836d",
  contentVariables: JSON.stringify(vars)
});

      }

      else if(properties.length == 4){

        for (let i = 0; i < 4; i++) {
  vars[String(i + 1)] = properties[i]?.property_name ?? "";
}


console.log(vars);
await twilioClient.messages.create({
  from: req.body.To,
  to: req.body.From,
  contentSid: "HX4d7c4c6ad20962f074c82431ab822db5",
  contentVariables: JSON.stringify(vars)
});

      }

      else if(properties.length == 5){
        for (let i = 0; i < 5; i++) {
  vars[String(i + 1)] = properties[i]?.property_name ?? "";
}


console.log(vars);
await twilioClient.messages.create({
  from: req.body.To,
  to: req.body.From,
  contentSid: "HXf316cf6bca9b4ded76a25ff5cc192dc6",
  contentVariables: JSON.stringify(vars)
});
      }

      else if(properties.length == 6){

         for (let i = 0; i < 6; i++) {
  vars[String(i + 1)] = properties[i]?.property_name ?? "";
}


console.log(vars);
await twilioClient.messages.create({
  from: req.body.To,
  to: req.body.From,
  contentSid: "HX030ff8cd7496a91a8055f860a7da9c81",
  contentVariables: JSON.stringify(vars)
});

      }
      else if(properties.length == 7){

        for (let i = 0; i < 7; i++) {
  vars[String(i + 1)] = properties[i]?.property_name ?? "";
}


console.log(vars);
await twilioClient.messages.create({
  from: req.body.To,
  to: req.body.From,
  contentSid: "HXcdf494121dec2a0e7b758e1191bf4af1",
  contentVariables: JSON.stringify(vars)
});

        

      }
      else if(properties.length == 8){

         for (let i = 0; i < 8; i++) {
  vars[String(i + 1)] = properties[i]?.property_name ?? "";
}


console.log(vars);
await twilioClient.messages.create({
  from: req.body.To,
  to: req.body.From,
  contentSid: "HX38dd61bbfae234c8c756774831c65358",
  contentVariables: JSON.stringify(vars)
});

      }
      else if(properties.length == 9){

        for (let i = 0; i < 9; i++) {
  vars[String(i + 1)] = properties[i]?.property_name ?? "";
}


console.log(vars);
await twilioClient.messages.create({
  from: req.body.To,
  to: req.body.From,
  contentSid: "HX75a15ed63669c6c3c309a786d68a77e6",
  contentVariables: JSON.stringify(vars)
});



      }
      else if(properties.length>=10){

        for (let i = 0; i < 10; i++) {
  vars[String(i + 1)] = properties[i]?.property_name ?? "";
}


console.log(vars);
await twilioClient.messages.create({
  from: req.body.To,
  to: req.body.From,
  contentSid: "HXccb8464aa16dfcbf749c9db603a1196b",
  contentVariables: JSON.stringify(vars)
});



      }

    }
    else if(fcx+1 == 4){

      await redis.hset("property",req.body.From,req.body.ListTitle);

      await twilioClient.messages.create({
  from: req.body.To,
  to: req.body.From,
  contentSid: "HX48c22096c89d9cc2ab17155318db5790"
});




    }
    else if(fcx+1 == 5){

      await twilioClient.messages.create({
  from: req.body.To,
  to: req.body.From,
  contentSid: "HX1142e6baf29cb88827c7841fd75da368"
});



    }
    else{
      let a = ["north_blr","east_blr","south_blr","west_blr","open"];
      let b = ["a","b","c","d"];
      let c = ["1_bhk","2_bhk","2.5_bhk","3_bhk","3.5_bhk","4_bhk","5_bhk"];

      if(a.includes(req.body.ListId)){

        await redis.hset("prop",req.body.From, req.body.ListTitle);

      }
      else if(b.includes(req.body.ListId)){

        await redis.hset("budget",req.body.From,req.body.ListId);


      }
      else if(c.includes(req.body.ListId)){

        let rg = req.body.ListId;  

      let bhk = "";

      if(rg == '1_bhk'){
        bhk = "1 BHK";
      }
      else if(rg == '2_bhk'){
        bhk = "2 BHK";
      }

      else if(rg == '2.5_bhk'){
        bhk = "2.5 BHK";
      }

      else if(rg == '3_bhk'){
        bhk = "3 BHK";

      }
      else if(rg == '3_5_bhk'){
        bhk = "3.5 BHK";
      }
      else if(rg == '4_bhk'){
        bhk = "4 BHK";
      }
      else if(rg == '5_bhk'){
        bhk = "5 BHK";
      }

      

        await redis.hset("room",req.body.From,bhk);

      




      }

      await redis.hset("whatsapp",req.body.From,2);
      await temp(req,res);



    }

    





  }
  else{
    
  const formattedNumber = `whatsapp:+91${req.body.Number}`;
    await redis.hset("whatsapp",formattedNumber,0);
    const message = await twilioClient.messages.create({
    from: "whatsapp:+14155238886",   // your Twilio WhatsApp number
    to: formattedNumber,     // user number
    contentSid: "HXc98e87b10ba399f04342943372b3acb7"
  });


  }
  
  



}

async function func(req){

  console.log("hello world");

  let rsp = await redis.hget("location",req.body.From);

  console.log(rsp);

  if(rsp == 'North Bangalore'){
          

          let i = await redis.hget("budget",req.body.From);
          if(i == "1-3cr"){
            await redis.hset("whatsapp_state",req.body.From,3);
            await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HX00b1524b911f4d60bbcce92a12468ded"
          });
          

          }
          else if(i == "3-5cr"){
            await redis.hset("whatsapp_state",req.body.From,3);
             await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HXdf27af385236240d67ba17224cf24b2f"
          });
          
            
          }

          else if(i=="5-8cr"||i=="8cr+"){
            await redis.hset("whatsapp_state",req.body.From,3);
            await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HXad861db9b17ad3842cd5afda2ca7a3fc"
          });
          

          




            

          }

        }
        else if(rsp == 'East Bangalore'){

          
          let i = await redis.hget("budget",req.body.From);

          if(i == "1-3cr"){
            await redis.hset("whatsapp_state",req.body.From,3);
            await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HX18c24ae4c50c799899a564d883d5d019"
          });
     

          }
          else if(i == "3-5cr"){
            await redis.hset("whatsapp_state",req.body.From,3);
             await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HX17228ac6807645c0f3b41cd753974c72"
          });
         
            
          }

          else if(i=="5-8cr"||i=="8cr+"){
            await redis.hset("whatsapp_state",req.body.From,3);
            await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HX6399b5327eabacab503fa67ea418b7b0"
          });
          




            

          }





        }
        else if(rsp == 'South Bangalore'){

        

          let i = await redis.hget("budget",req.body.From);

          if(i == "1-3cr"){
            await redis.hset("whatsapp_state",req.body.From,3);
            await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HX18c24ae4c50c799899a564d883d5d019"
          });
         

          }
          else if(i == "3-5cr"){
            await redis.hset("whatsapp_state",req.body.From,3);
             await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HX7cc31e238ce53457f4953fffeac1c623"
          });
          
            
          }

          else if(i=="5-8cr"||i=="8cr+"){
            await redis.hset("whatsapp_state",req.body.From,3);
            await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HX0bd1f58ef6e48c94a706cacc2f7cd5d7"
          });
          




            

          }


        }
        else if(rsp == 'Central Bangalore'){

       
          await redis.hset("whatsapp_state",req.body.From,3);
          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HX276f05b98cb0fe527ad80a6727d71a87"
          });
          

        }
        else if(rsp == 'open to any location'){

          let i = await redis.hget("budget",req.body.From);
          if(i == "1-3cr"){
            await redis.hset("whatsapp_state",req.body.From,3);
            await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HX00b1524b911f4d60bbcce92a12468ded"
          });
          

          }
          else if(i == "3-5cr"){
            await redis.hset("whatsapp_state",req.body.From,3);
             await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HXdf27af385236240d67ba17224cf24b2f"
          });
          
            
          }

          else if(i=="5-8cr"||i=="8cr+"){
            await redis.hset("whatsapp_state",req.body.From,3);
            await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HXad861db9b17ad3842cd5afda2ca7a3fc"
          });
          

          




            

          }
          

        }





}

async function p(req){

  let rsp = req.body.ListId;
  await redis.hset("whatsapp_state",req.body.From,4);


  if(rsp == "brigade"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HXc6b9bbd0ec760346a10ec635939d9b7b"

          });


        }
        else if(rsp == "godrej"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX6c1f44e1901fabe404ad44d50376557f"

          });


          
        }
        else if(rsp == "nico"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX759b5ae3164ed0237a30eeafdd08ddda"

          });



        }

        else if(rsp == "lnt"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX1047c0c01ca60a846dbfe201317ae907"

          });

        }

        else if(rsp == "inthat"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HXdf120a374f2f5e26c25bf734fbcaff95"

          });

        }

        else if(rsp == "insig"){

           await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HXeeb6d2736607eef0820628898c968339"

          });

        }
        else if(rsp == "lntheb"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HXf23f707e058e463e19eef12830117271"

          });

        }

        else if(rsp == "maia"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX314aedfe706adc2e6c1c826d5e1b7c54"

          });

          

        }

        else if(rsp == "down"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX01dec7be154b8560b98307cad998a9e6"

          });

        }

        else if(rsp == "mahindra"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX5be89749530f092327b81f0185ae95ba"

          });

        }

        else if(rsp == "prestiege"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HXeb3dbea1583c259ea9c18aa6c2e58c40"

          });

          

        }

        else if(rsp == "namb"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HXd440820aa1e1ac300371fc095603f9fd"

          });

        }

        else if(rsp == "por"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX75ff716f1c7cb2c74c1cfae8efe8ef4d"

          });

        }

         else if(rsp == "blossom"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HXfd293a819a96d30e71c5da3f8c6e45b8"

          });

        }

        else if(rsp == "lod"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HXe96169d85bc8cf7b09d10c95d0019fd2"

          });
          
        }

         else if(rsp == "windmills"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX85850f5ab1090212afb5e0d87cb2f81f"

          });
          
        }

        else if(rsp == "meadows"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX8853beff2fe875cdcb4701e4e2127edf"

          });
          
        }

        else if(rsp == "arr"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX45af2c32cdce29abd1cbf3da2d7fb915"

          });


        }
        else if(rsp == "t"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX5865f6bab95fbeb712eb7ce047110cb9"

          });

        }

        else if(rsp == "magnus"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX457395a4064047460f38f5ddb862b894"

          });

        }

        else if(rsp == "azur"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX7c841b5618495be85a6f956b178ca379"

          });

        }

        else if(rsp == "fly"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX7c841b5618495be85a6f956b178ca379"

          });

        }

         else if(rsp == "d35"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX5e90d9fd22803131a9ecea093d80d347"

          });

        }

        else if(rsp == "century"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX8b9b49a43e77528d1698761c6e16f457"

          });
          
        }

        else if(rsp == "radiance"){

           await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HXce90bd275464fa5b5290cf8bc9e337e4"

          });
          

        }

         else if(rsp == "tvs"){

           await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HXb9d094c60821402cda1f07c9600707f7"

          });
          

        }



}

app.post("/chat", async (req, res) => {
  
  try{

    let a = req.body.From;
    let rgd = await redis.hexists("whatsapp_state",a);
    if(rgd == 1){

      let rsp = req.body.ListId;
      //let rfd = await redis.hget("whatsapp_state",a);
      //let i = Number(rfd);

      if(rsp == 'one' || rsp == 'two'){

        

        if(rsp == 'one'){

          await redis.hset("interest",req.body.From,"for end use");

        }
        else if(rsp == 'two'){

          await redis.hset("interest",req.body.From,"for good investment");
          
        }

        //await redis.hset("whatsapp_state",req.body.From,1);

        

        await twilioClient.messages.create({
          from:req.body.To,
          to:req.body.From,
          contentSid:"HXe2ab9f2782c1f1401a69572a36faacb7"
        });

        
      }

      else if(rsp == 'a' || rsp == 'b' || rsp == 'c' || rsp == 'd'){

        console.log(rsp);
        if(rsp == "a"){

          await redis.hset("budget",req.body.From,"1-3cr");

        }
        else if(rsp == "b"){
          await redis.hset("budget",req.body.From,"3-5cr");
        }
        else if(rsp == "c"){
          await redis.hset("budget",req.body.From,"5-8cr");
        }
        else if(rsp == "d"){
          await redis.hset("budget",req.body.From,"8cr+");
        }

        //await redis.hset("whatsapp_state",req.body.From,2);

        await twilioClient.messages.create({
          from:req.body.To,
          to:req.body.From,
          contentSid: "HX69e73aa54e7c08b7c75a1e13a98584eb"
        });

      }

      else if(rsp == 'north_blr' || rsp == 'east_blr' || rsp == 'south_blr' || rsp == 'central_blr'||rsp == 'open'){

        if(rsp == 'north_blr'){
          await redis.hset("location",req.body.From,"North Bangalore");

          let i = await redis.hget("budget",req.body.From);
          if(i == "1-3cr"){
            //await redis.hset("whatsapp_state",req.body.From,3);
            await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HX00b1524b911f4d60bbcce92a12468ded"
          });
          

          }
          else if(i == "3-5cr"){
            //await redis.hset("whatsapp_state",req.body.From,3);
             await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HXdf27af385236240d67ba17224cf24b2f"
          });
          
            
          }

          else if(i=="5-8cr"||i=="8cr+"){
            //await redis.hset("whatsapp_state",req.body.From,3);
            await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HXad861db9b17ad3842cd5afda2ca7a3fc"
          });
          

          




            

          }

        }
        else if(rsp == 'east_blr'){

          await redis.hset("location",req.body.From,"East Bangalore");
          let i = await redis.hget("budget",req.body.From);

          if(i == "1-3cr"){
            //await redis.hset("whatsapp_state",req.body.From,3);
            await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HX18c24ae4c50c799899a564d883d5d019"
          });
     

          }
          else if(i == "3-5cr"){
            //await redis.hset("whatsapp_state",req.body.From,3);
             await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HX17228ac6807645c0f3b41cd753974c72"
          });
         
            
          }

          else if(i=="5-8cr"||i=="8cr+"){
            //await redis.hset("whatsapp_state",req.body.From,3);
            await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HX6399b5327eabacab503fa67ea418b7b0"
          });
          




            

          }





        }
        else if(rsp == 'south_blr'){

          await redis.hset("location",req.body.From,"South Bangalore");

          let i = await redis.hget("budget",req.body.From);

          if(i == "1-3cr"){
            //await redis.hset("whatsapp_state",req.body.From,3);
            await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HX7cc31e238ce53457f4953fffeac1c623"
          });
         

          }
          else if(i == "3-5cr"){
            //await redis.hset("whatsapp_state",req.body.From,3);
             await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HX7cc31e238ce53457f4953fffeac1c623"
          });
          
            
          }

          else if(i=="5-8cr"||i=="8cr+"){
            //await redis.hset("whatsapp_state",req.body.From,3);
            await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HX0bd1f58ef6e48c94a706cacc2f7cd5d7"
          });
          




            

          }


        }
        else if(rsp == 'central_blr'){

          await redis.hset("location",req.body.From,"Central Bangalore");
          //await redis.hset("whatsapp_state",req.body.From,3);
          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HX276f05b98cb0fe527ad80a6727d71a87"
          });
          

        }
        else if(rsp == 'open'){
          await redis.hset("location",req.body.From,"open to any location");


          let i = await redis.hget("budget",req.body.From);
          if(i == "1-3cr"){
            //await redis.hset("whatsapp_state",req.body.From,3);
            await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HX00b1524b911f4d60bbcce92a12468ded"
          });
          

          }
          else if(i == "3-5cr"){
            //await redis.hset("whatsapp_state",req.body.From,3);
             await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HXdf27af385236240d67ba17224cf24b2f"
          });
          
            
          }

          else if(i=="5-8cr"||i=="8cr+"){
            //await redis.hset("whatsapp_state",req.body.From,3);
            await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid:"HXad861db9b17ad3842cd5afda2ca7a3fc"
          });
          

          




            

          }

        }

        

      }
      else if(rsp == "offline_visit" || rsp == "online_visit"){

        await redis.hset("visittype",req.body.From,rsp);
        await twilioClient.messages.create({
          from:req.body.To,
          to:req.body.From,
          contentSid:"HX6b23f8779c7d9708c76fc0d2c83df439"
        });

      }

      else{
        await redis.hset("property_chosen",req.body.From,req.body.ListTitle);
        //await redis.hset("whatsapp_state",req.body.From,4);

        if(rsp == "brigade"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX71a7581e3414cb5a9e74422fbe85b59b"

          });


        }
        else if(rsp == "godrej"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HXabf4622e0dacea5e75b288777f8cb61f"

          });


          
        }
        else if(rsp == "nico"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HXce052425eb1cf2d83743693c6afcb866"

          });



        }

        else if(rsp == "lnt"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX19cb01fc664f6a2edae2fa89fa6523f2"

          });

        }

        else if(rsp == "inthat"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX7aaed0e640ad5d4c8f0f63e054b84219"

          });

        }

        else if(rsp == "insig"){

           await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX3552ef9d5657c3a08a904c1ad058c270"

          });

        }
        else if(rsp == "lntheb"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX711ff64906b5c55a0c6e9f365a597ca7"

          });

        }

        else if(rsp == "maia"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX618a4b43284a9e8aa75e6db1df9c617c"

          });

          

        }

        else if(rsp == "down"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX9ffbf7ae2f58224610327893bafc77f3"

          });

        }

        else if(rsp == "mahindra"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX8dd0034ef93da0abe387cf90db156e8"

          });

        }

        else if(rsp == "prestiege"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX52ff78357b5cd993cd098bd16db3a2c7"

          });

          

        }

        else if(rsp == "namb"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX6f758954287c20258ad282513d893a60"

          });

        }

        else if(rsp == "por"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX6c4b70bf792cbc019019c9b84da5ae06"

          });

        }

         else if(rsp == "blossom"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX04734fec11b8f54984866d344695ac8d"

          });

        }

        else if(rsp == "lod"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX95b42e9d27aa3c4301956e377a16c2eb"

          });
          
        }

         else if(rsp == "windmills"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX3c6da17e890b3918ee43779aaa840bbb"

          });
          
        }

        else if(rsp == "meadows"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX24b7f9b12d0ff3a2d078ddd4e2302049"

          });
          
        }

        else if(rsp == "arr"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX62f754ef4e72ad12eb6c5955ab2dc4be"

          });


        }
        else if(rsp == "t"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX8a7a5d764b2769c9e758ef637f634148"

          });

        }

        else if(rsp == "magnus"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX4b45b3d1cb99e85adec7f5851087fc94"

          });

        }

        else if(rsp == "azur"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX1fb6d4b4a3b0bb83ebe7fe6a177fc831"

          });

        }

        else if(rsp == "fly"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX24c548b08d8366cc953fe89d2a824290"

          });

        }

         else if(rsp == "d35"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HXe6911d76bea1790d31ae9a3012305adf"

          });

        }

        else if(rsp == "century"){

          await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX8e96d59d001fdbf05a6c868d685b96f9"

          });
          
        }

        else if(rsp == "radiance"){

           await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HX1b712d0a45a09da7902a7fdc344a8be3"

          });
          

        }

         else if(rsp == "tvs"){

           await twilioClient.messages.create({
            from:req.body.To,
            to:req.body.From,
            contentSid: "HXec21ce0dfb1d637870b6d9d71a54376a"

          });
          

        }



















      }

      /*else if(i+1>4){
        if(rsp == 'one'||rsp == 'two'){

           if(respnse == 'one'){

          await redis.hset("interest",req.body.From,"for end use");

        }
        else if(rsp == 'two'){

          await redis.hset("interest",req.body.From,"for good investment");
          
        }

        await func(req);



        }
        else if(rsp == 'north_blr'||rsp == 'south_blr' || rsp == 'east_blr'||rsp == 'central' || rsp == 'open'){

      

        if(rsp == 'north_blr'){
          await redis.hset("location",req.body.From,"North Bangalore");

          
          

          

        }
        else if(rsp == 'east_blr'){

          await redis.hset("location",req.body.From,"East Bangalore");


        }
        else if(rsp == 'south_blr'){

          await redis.hset("location",req.body.From,"South Bangalore");

          


        }
        else if(rsp == 'central_blr'){

          await redis.hset("location",req.body.From,"Central Bangalore");
          
          

        }
        else if(rsp == 'open'){
          await redis.hset("location",req.body.From,"open to any location");

        }

        await func(req);

        

      }

      else if(rsp == "a" || rsp == "b" || rsp == "c" || rsp == "d"){

        if(rsp == 'a'){

          await redis.hset("budget",req.body.From,"1-3cr");

        }
        else if(rsp == 'b'){
          await redis.hset("budget",req.body.From,"3-5cr");
        }
        else if(rsp == 'c'){
          await redis.hset("budget",req.body.From,"5-8cr");
        }
        else if(rsp == 'd'){
          await redis.hset("budget",req.body.From,"8cr+");
        }

        await func(req);

      }
      else{

        await redis.hset("property_chosen",req.body.From,req.body.ListTitle);
        await p(req);

      }

        }*/
      

      





    }
    else{

      //another lead concurrency // removing duplicate leads

      let Number = req.body.Number;
      let Source = req.body.Source;
      let formatted_number = "whatsapp:+91" + String(Number);

      let ccdewq = await redis.hexists("whatsapp_state",formatted_number);

      if(ccdewq != 1){

        await redis.hset("whatsapp_state",formatted_number,0);
      await twilioClient.messages.create({
        from: "whatsapp:+14155238886",
        to:formatted_number,
        contentSid:"HX506e59f96354970547b6ed9a136ae8ea",
        contentVariables: JSON.stringify({
          "1":Source
        })
      });

      }

       
     





      

    }

  }
  catch(error){
    console.log(error);
  }
  
  res.status(200).end();
});

app.post("/llm",async (req,res)=>{

});


app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

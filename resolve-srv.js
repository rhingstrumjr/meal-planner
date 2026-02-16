const dns = require('dns');

const cluster = "cluster0.bibrvt3.mongodb.net";
const srv = `_mongodb._tcp.${cluster}`;

console.log(`Resolving SRV: ${srv}...`);

dns.resolveSrv(srv, (err, addresses) => {
    if (err) {
        console.error("SRV Lookup Failed:", err.message);
        // Fallback: Try A Records directly
        dns.resolve4(cluster, (err2, ips) => {
             if (err2) console.error("A Record Lookup Failed:", err2.message);
             else console.log("Direct IP:", ips);
        });
        return;
    }

    console.log("SRV Records Found:", addresses);
    
    // Construct the standard string
    const hosts = addresses.map(a => `${a.name}:${a.port}`).join(',');
    const uri = `mongodb://rhingstrum:atlas123@${hosts}/?ssl=true&replicaSet=atlas-shard-0&authSource=admin&retryWrites=true&w=majority`;
    
    console.log("\nStandard URI (Try this):");
    console.log(uri);
});

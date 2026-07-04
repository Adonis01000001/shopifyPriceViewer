const fs = require("fs");
const p = "D:\PV\shopify price viwer\docs\superpowers\plans\roadmap_test.txt";
fs.writeFileSync(p, "test");
console.log("OK", fs.statSync(p).size);

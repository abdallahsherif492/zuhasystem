const x = "string";
try {
  x.map(e => e);
} catch (e) {
  console.log(e.toString());
}

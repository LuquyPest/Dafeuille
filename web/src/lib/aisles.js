/* Rayons du magasin (classement automatique de la liste de courses) */
export const AISLES = [
  ["Fruits et légumes", ["pomme","banane","orange","citron","tomate","salade","carotte","oignon","ail","pomme de terre","patate","courgette","poivron","fraise","raisin","avocat","concombre","champignon","légume","legume","fruit","poireau","brocoli","épinard","kiwi","poire"]],
  ["Frais", ["lait","yaourt","yogourt","fromage","beurre","crème","creme","oeuf","œuf","jambon","lardon","emmental","mozzarella","comté","compote","dessert","saumon fumé","houmous"]],
  ["Boucherie et poisson", ["poulet","boeuf","bœuf","steak","viande","porc","saucisse","dinde","poisson","saumon","cabillaud","crevette","thon frais","merguez","veau","agneau"]],
  ["Boulangerie", ["pain","baguette","brioche","croissant","viennoiserie","pain de mie"]],
  ["Épicerie", ["pâtes","pates","riz","farine","sucre","sel","huile","vinaigre","conserve","thon","sauce","café","cafe","thé","the ","céréale","cereale","biscuit","chocolat","confiture","miel","épice","epice","moutarde","ketchup","mayonnaise","lentille","semoule","gâteau","gateau","chips","bonbon"]],
  ["Boissons", ["eau","jus","soda","coca","bière","biere","vin","sirop","limonade"]],
  ["Surgelés", ["surgelé","surgele","glace","pizza","frites","poêlée","poelee"]],
  ["Hygiène et beauté", ["shampo","gel douche","savon","dentifrice","brosse à dents","déo","deo","coton","rasoir","crème hydratante","maquillage","serviette hyg","tampon","mouchoir"]],
  ["Entretien", ["lessive","liquide vaisselle","éponge","eponge","javel","sac poubelle","papier toilette","pq","essuie-tout","sopalin","nettoyant","adoucissant","tablette lave"]],
  ["Bébé", ["couche","lingette","petit pot","lait infantile","biberon"]],
];
export const AISLE_ICONS = {"Fruits et légumes": "apple", "Frais": "milk", "Boucherie et poisson": "beef", "Boulangerie": "croissant", "Épicerie": "wheat", "Boissons": "cup-soda", "Surgelés": "snowflake", "Hygiène et beauté": "droplets", "Entretien": "spray-can", "Bébé": "baby"};
export function aisleOf(name){
  const n = " " + String(name).toLowerCase() + " ";
  for (const [a, words] of AISLES) if (words.some(w => n.includes(w))) return a;
  return "Autre";
}

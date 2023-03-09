import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

var obsidian = require('obsidian');

class CronievBookkeeping extends obsidian.Plugin {
	constructor(){
		super(...arguments);
		// const pots_names = ["Besorgung","Einkauf","Frei","Geld","Intake","Sonstiges","Wiederholung"]
	}

	async onload() {
		return __awaiter(this, void 0, void 0, function* () {
			console.log('Loading plugin CronievBookkeeping...');
			yield this.loadSettings();
			this.addSettingTab(new CronievBookkeepingSettingsTab(this.app,this));
			yield this.saveSettings();
			// This adds an editor command that can perform some operation on the current editor instance
			this.addCommand({
				id: 'update-ledger',
				name: 'Update Ledger',
				callback: () => {
					this.updateLedger();
				},
				hotkeys: [
						{
								modifiers: ['Ctrl'],
								key: 'L',
						},
				]
			});
		});
	}

	async onunload() {
        console.log('Unloading plugin CronievBookkeeping...');
	}
	loadSettings() {
			return __awaiter(this, void 0, void 0, function* () {
					this.settings = Object.assign({}, DEFAULT_SETTINGS, yield this.loadData());
			});
	}
	saveSettings() {
			return __awaiter(this, void 0, void 0, function* () {
					yield this.saveData(this.settings);
			});
	}

	async updateLedger(){
		console.log("Croniev Bookkeeping: Compiling file "+this.settings.transaction_file+" into file "+this.settings.ledger_file);
		let doc_ledger = this.app.vault.getAbstractFileByPath(this.settings.ledger_file);
		var str_transactions;
		try{
			str_transactions = await this.app.vault.read(this.app.vault.getAbstractFileByPath(this.settings.transaction_file));
			this.app.vault.modify(doc_ledger, "Processing...");
		} catch(e){
			if (e instanceof TypeError){
				throw new LedgerError("Your transaction and/or ledger file does not exist");
			}
		}
		try {
			checkSettings(this.settings.bucket_names,this.settings.piechart_buckets);

			// Aufteilen aller Zeilen in arrays mit Zeilen eines Monats.
			let months_map = makeMonthsMap(str_transactions.split("\n"));
			// Alle Tabellen und Überschriften werden in einer String gesammelt
			let new_doc = "";
			// Tabellenköpfe
			let buckets_list = Object.keys(this.settings.table_sums);
			let table_head = makeTableHead(buckets_list, this.settings.bucket_names);
			let empty_row = makeEmptyTableRow(buckets_list.length);
			// Vorlage für Sortierung
			let sorted_buckets = new Map<string,array>();
			Object.entries(this.settings.bucket_names).forEach(function([k,v]) {
				sorted_buckets.set(k,[])
			});
			// Für jeden Monat Tabelle anlegen
			months_map.forEach((arr,mon) => {
				// Einträge nach Buckets sortieren
				let sorted_buckets_mon = new Map(JSON.parse(JSON.stringify(Array.from(sorted_buckets))));
				sortTransactions(sorted_buckets_mon,arr);
				// settings.Table_sums errechnen
				let buckets_sums = sumBuckets(sorted_buckets_mon);
				let sum_entries = makeSumEntries(buckets_sums,this.settings.table_sums);
				// ---- String erstellen ----
				// Überschrift plus Tabellenkopf
				new_doc += mon + "\n" + table_head;
				// IF plugin.setting.include_transactions: Zeilenweise Einträge hinzufügen
				if (this.settings.include_transactions){
					new_doc += makeTableFromMap(buckets_list,stringifyAndReverseTransactionMap(sorted_buckets_mon));
					new_doc += empty_row;
				}
				// settings.Table_sums hinzufügen
				new_doc += makeTableFromMap(buckets_list,sum_entries);
				// piechart hinzufügen
				if (this.settings.include_piechart){
					new_doc += makePiechartFromMap(this.settings.piechart_buckets, buckets_sums, this.settings.bucket_names);
				}
			});
			// Ledger modifizieren
			this.app.vault.modify(doc_ledger, new_doc);
		} catch (e){
			if (e instanceof LedgerError){
				this.app.vault.modify(doc_ledger, e.message);
			}else{
				throw e;
			}
		}
	}
}

function checkSettings(buckets, piechart){
	for (var k of Object.keys(buckets)){
		if(k.length > 1){
			throw new LedgerError("Bucket classifiers should only be 1 character long: `"+k+"`\nPlease check your 'Buckets' Settings");
		}
	}
	for (var k of piechart) {
		if(Object.keys(buckets).indexOf(k) == -1){
			throw new LedgerError("You are trying to piechart an undeclared bucket: `"+k+"`\nPlease check your 'Buckets to display in piechart' Settings");
		}
	}
}

function makeMonthsMap(arr_transactions){
	let months_map = new Map<string,array>();
	let month:string;
	for (const line of arr_transactions){
		if (line=="\n" || line==""){
			continue;
		}
		// Falls es eine Überschrift ist, neues Element im Dict anlegen.
		if (line.indexOf("#") != -1){
			month = line;
			let arr:string[] = [];
			months_map.set(month,arr);
		}else{ // Ansonsten die Zeilen sammeln.
			let arr:string[] = months_map.get(month);
			arr.push(line);
		}
	}
	return months_map
}

function makeTableHead(buckets,bucket_names){
let table_head = "|";
let table_head2="|";
for (const b of buckets){
	table_head += bucket_names[b]+"|";
	table_head2 += " --- |";
}
return table_head + "\n" + table_head2 + "\n";
}

function sortTransactions(map,arr){
	for (const t of arr){
		let split = makeTransaction(t);
		if (!map.has(split[0])){ // Is valid bucket?
			throw new LedgerError("Undefined Bucket used: ("+t+")");
		}
		map.get(split[0]).push(split.slice(1));
	}
}

function makeTransaction(t, buckets){
	let split = t.split(" ");
	if (split[0] == "" || split[1] == ""){
		throw new LedgerError("Too many spaces before bucket or amount: ("+t+")");
	}
	let desc = split.slice(2).join(" ");
	if (isNaN(split[1])){
		throw new LedgerError("Amount is not a number: ("+t+")");
	}
	return [split[0],split[1],desc];
}

function sumBuckets(map){
	let sums = new Map<string,float>();
	map.forEach((ts,b) => {
		let sum = 0;
		for (const t of ts){
			sum += parseFloat(t);
		}
		sums.set(b,sum.toFixed(2));
	});
	return sums;
}

function makeSumEntries(sums, table_sums){
	let sum_entries = new Map<string,array>();
	Object.entries(table_sums).forEach(function([k,v]){
		if (!sums.has(k)){
			throw new LedgerError("You want to display an undeclared bucket in the table: `"+k+"`\nPlease check your 'Sums Shown in Table' Settings");
		}
		sum_entries.set(k,[]);
		let combinations = v.split(",");
		for (var s of combinations){
			let vorzeichen = 1;
			let tmp = 0;
			let strVz = s[0];
			for (const c of s.slice(1)){
				if (c == "+"){
					vorzeichen = 1;
				} else if (c == "-"){
					vorzeichen = -1;
				} else {
					if (!sums.has(c)){
						throw new LedgerError("You are trying to calculate with an undeclared bucket: `"+c+"` in `"+k+": "+s+"`\nPlease check your 'Sums Shown in Table' Settings");
					}
					tmp += vorzeichen* parseFloat(sums.get(c));
				}
			}
			switch(strVz){
				case "+":
					if (tmp < 0){
						strVz = "";
					}
					break;
				case "-":
					if (tmp <0){
						strVz = "+";
					}else{
						strVz = "";
					}
					tmp *= -1;
					break;
				case "0":
					strVz = "";
					break;
			}
			sum_entries.get(k).push(strVz + tmp.toFixed(2));
		}
	});
	return sum_entries;
}

function makeEmptyTableRow(lena){
	let row = "|";
	for (let i=0;i<lena;i++ ) {
		row += " |";
	}
	return row+"\n";
}
   
function stringifyAndReverseTransactionMap(map){
	let new_map = new Map<string,array>();
	map.forEach((v,k) => {
		let list = [];
		for (const element of v){
			list.push(element.join(" "));
		}
		new_map.set(k,list.reverse());
	});
	return new_map;
}
  
function makeTableFromMap(buckets, map){
	let exhausted = [];
	let table = "";
	let row = 0;
	buckets.forEach(element => { exhausted.push(0);});
	while (exhausted.includes(0)){
		table += "|";
		for (let i=0;i<buckets.length;i++){
			if (exhausted[i] == 0){
				let map_el = map.get(buckets[i]);
				if (map_el[row] != undefined){
					table += map_el[row];
				}
				if (map_el.length <= row+1){
					exhausted[i] = 1;
				}
			}
			table += " |";
		}
		table += "\n";
		row++;
	}
	return table;
}

function makePiechartFromMap(buckets, map, names){
	result = ">[!info]- Piechart\n> ```mermaid\n> pie\n"
	for (const b of buckets){
		result += '> "'+names[b]+'":'+map.get(b)+"\n";
	}
	result += "> ```\n\n";
	return result;
}

function bucketsToDict(bucketsInput){
	let buckets: array = bucketsInput.split("\n");
	let dict = {};
	for (const b of buckets){
		if (b != ""){
			split = b.split(": ");
			dict[split[0]] = split[1];
		}
	}
	return dict;
}

function dictToBuckets(dict){
	out = ""
	Object.entries(dict).forEach(function([k,v]){
		out += k + ": " + v +"\n";
	});
	return out;
}

class LedgerError extends Error{
	constructor(message){
		super(message);
	}
}

const DEFAULT_SETTINGS = {
	transaction_file: "_transactions.md",
	ledger_file: "_ledger.md",
	bucket_names: {'s':"Savings",'i':"Income",'r':"Recurring",'e':"Errands",'x': "Else",'f':"Freetime",'g':"Groceries"},
	table_sums: {'g':"-g",'f':"-f",'e':"-e,-g+f+e",'x':"-x,-g+f+e+x",'r':"-r,-g+f+e+x+r",'i':"+i,+i-g-f-e-x-r,0s+i-g-f-e-x-r"},
	include_transactions: true,
	include_piechart: false,
	piechart_buckets: ["g","f","e","x","r"]
}

class CronievBookkeepingSettingsTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
      super(app, plugin);
      this.plugin = plugin;
  }
	display() {
    let { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Croniev Bookkeeping - Settings' });
		new obsidian.Setting(containerEl)
			.setName("Transactions File")
			.setDesc("Type the path to the file you want to add the transactions to")
			.addTextArea((text) => text
			.setPlaceholder("_transactions.md")
			.setValue(this.plugin.settings.transaction_file)
			.onChange((value) => __awaiter(this, void 0, void 0, function* () {
			if (value == '') {
					value = '_transactions.md';
			}
			this.plugin.settings.transaction_file = value;
			yield this.plugin.saveSettings();
		})));
	  new obsidian.Setting(containerEl)
			.setName("Ledger File")
			.setDesc("Type the path to the file you want the ledger to be added to")
			.addTextArea((text) => text
			.setPlaceholder("_ledger.md")
			.setValue(this.plugin.settings.ledger_file)
			.onChange((value) => __awaiter(this, void 0, void 0, function* () {
			if (value == '') {
					value = '_ledger.md';
			}
			this.plugin.settings.ledger_file = value;
			yield this.plugin.saveSettings();
		})));
	  new obsidian.Setting(containerEl)
			.setName("Buckets")
			.setDesc("Type the classifier (only one character) and Name of the buckets you want to use, one bucket per line")
			.setClass("bookkeeping-tall-field")
			.addTextArea((text) => text
			.setPlaceholder("i: Income")
			.setValue(dictToBuckets(this.plugin.settings.bucket_names))
			.onChange((value) => __awaiter(this, void 0, void 0, function* () {
				this.plugin.settings.bucket_names = bucketsToDict(value);
				yield this.plugin.saveSettings();
		})));
	  new obsidian.Setting(containerEl)
			.setName("Sums Shown in Table")
			.setDesc("In the order that the buckets should appear in the table add (one row for each bucket) which sum combinations should be shown at the bottom of the table. Only '+' and '-' are supported.\nEach combination should start with one of the following Symbols: '+' to show the sign of the sum, '-' to show the opposite of the sign, and '0' to not show positive signs.")
			.setClass("bookkeeping-tall-field")
			.addTextArea((text) => text
			.setPlaceholder('e: -e,-g+f+e')
			.setValue(dictToBuckets(this.plugin.settings.table_sums))
			.onChange((value) => __awaiter(this, void 0, void 0, function* () {
				this.plugin.settings.table_sums = bucketsToDict(value);
				yield this.plugin.saveSettings();
		})));
		new obsidian.Setting(containerEl)
				.setName("Display Transactions in Table")
				.setDesc("Add a list of the transactions to the table.")
				.addToggle(toggle => toggle.setValue(this.plugin.settings.include_transactions)
				.onChange((value) => __awaiter(this, void 0, void 0, function* () {
					this.plugin.settings.include_transactions = !this.plugin.settings.include_transactions;
					yield this.plugin.saveSettings();
		})));
		new obsidian.Setting(containerEl) //include_piechart
				.setName("Display piechart for each month")
				.addToggle(toggle => toggle.setValue(this.plugin.settings.include_piechart)
				.onChange((value) => __awaiter(this, void 0, void 0, function* () {
					this.plugin.settings.include_piechart = !this.plugin.settings.include_piechart;
					yield this.plugin.saveSettings();
					this.display();
		})));
		if (this.plugin.settings.include_piechart){
			new obsidian.Setting(containerEl) // piechart_buckets
				.setName("Buckets to display in piechart")
				.setDesc("Separated by comma.")
				.addTextArea((text) => text
				.setValue(this.plugin.settings.piechart_buckets.join(","))
				.onChange((value) => __awaiter(this, void 0, void 0, function* () {
					this.plugin.settings.piechart_buckets = value.split(",");
					yield this.plugin.saveSettings();
			})));
		}
	}
}

module.exports = CronievBookkeeping;

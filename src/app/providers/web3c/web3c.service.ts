import { Injectable } from '@angular/core';
import * as Web3c from '@cypherium/web3c';
import * as sha from 'sha.js';
import { HttpClientModule, HttpClient } from '@angular/common/http';
import * as CypheriumTx from 'cypheriumjs-tx';
import { THIS_EXPR } from '@angular/compiler/src/output/output_ast';
import { GlobalService } from '../global/global.service';
// import * as Secp from 'secp256k1';
import { environment } from '../../../environments/environment';


const TX_VERSION = '0x122';
const TX_DEFAULT_GASLIMIT = '0x5208';
declare var Buffer;
@Injectable({
    providedIn: 'root'
})

export class Web3Service {
    public web3c;
    private pledgeContract;

    constructor(
        private http: HttpClient,
        private global: GlobalService
    ) {
        this.web3c = new Web3c(new Web3c.providers.HttpProvider(this.global.provider || environment.cypherium.provider));
        this.http.get('assets/json/pledge.abi.json').subscribe((abi: any) => {
            console.log("abi File loading successfully" + JSON.stringify(abi));
            this.pledgeContract = new this.web3c.cph.contract(abi, environment.cypherium.pledgeContractAddr);
            return this.pledgeContract;
        });
    }

    async isCphAddr(addr) {
        if (!addr) {
            return -1;
        }
        addr = addr.toLowerCase();
        if (!addr.startsWith('cph')) {
            return -2;
        }
        let result = await this.web3c.isAddress('0x' + addr.slice(3));
        return result ? 0 : -2;
    }

    async getBlockHeight() {
        let height = await this.web3c.cph.txBlockNumber;
        return height;
    }

    async getKeyBlockHeight() {
        let height = await this.web3c.cph.keyBlockNumber;
        return height;
    }

    initContract(name, abi, addr) {
        if (this[name]) {
            return this[name];
        } else {
            this[name] = new this.web3c.cph.contract(abi, addr);
            console.log("Contract initializes successfully:", name, addr);
            return this[name];
        }
    }

    getCphBalance(userAddr, callback, pending = false) {
        console.log('getCphBalance');
        this.web3c.cph.getBalance(userAddr, pending ? 'pending' : 'latest', (e,v) => {
            if (!e) {
                let value = this.web3c.fromWei(v, 'cpher');
                callback(value);
            } else {

                console.log('read from local');
                if (this.global.currentWalletIndex !== undefined) {
                    callback(this.global.gWalletList[this.global.currentWalletIndex].amount);
                } else {
                    callback(0);
                }
            }
        });
    }

    getMortage(from) {
        return new Promise((resolve, reject) => {
            this.pledgeContract.methods.mortgageOf(from).call({ from: from }, (err, result) => {
                if (err) {
                    resolve(0);
                } else {
                    console.log("pledge", result);
                    let value = this.web3c.fromWei(result + "", 'cpher');
                    resolve(value);
                }
            });
        })
    }

    async pledge(type, from, amount, privateKey, callback) {
        amount = this.web3c.toWei(amount + "", 'cpher');
        let gasPrice = await this.web3c.cph.getGasPrice();
        if (!gasPrice || gasPrice == '0') {
            gasPrice = this.web3c.toWei(18, 'gwei');
        }
        let params = type == 'mortgage' ? [from, amount] : [amount];
        let tx = await this.generateCphTx(from, environment.cypherium.pledgeContractAddr, '0x0', gasPrice, privateKey, 'pledgeContract', type, params);
        const serializedTx = tx.serialize();
        this.web3c.cph.sendSignedTransaction('0x' + serializedTx.toString('hex'), callback); //Call the contract
    }

    async transferCph(from, to, value, gasPrice, privateKey, callback) {
        console.log(`initiate transfer----from:${from},to:${to},value:${value}`);
        value = this.web3c.toWei(value, 'cpher');
        if (!gasPrice || gasPrice == '0') {
            gasPrice = this.web3c.toWei(18, 'gwei');
        } else {
            gasPrice = this.web3c.toWei(gasPrice + "", 'gwei');
        }
        let tx = await this.generateCphTx(from, to, value, gasPrice, privateKey);
        console.log("Transaction signature：", tx)
        const serializedTx = tx.serialize();
        this.web3c.cph.sendRawTransaction('0x' + serializedTx.toString('hex'), callback);

    }

    async generateCphTx(
        from,
        to,
        value,
        gasPrice,
        privateKey, //Account private key, used for signing
        contractName = "",
        funcname = "",
        params = null
    ) {
        let data = "";
        if (params) {
            var thisobj = this[contractName].methods[funcname]; //Extract the function from the target contract object
            data = thisobj.apply(thisobj, params).encodeABI(); //Encapsulate parameters as contract parameters
        }

        try {
            var nonce = await this.web3c.cph.getTransactionCount('0x' + from, 'pending'); //Get the address of the user's walletnonce
        } catch (error) {
            var nonce = await this.web3c.cph.getTransactionCount('0x' + from); //Get the address of the user's walletnonce
        }
        const txParams = {
            version: TX_VERSION,
            senderKey: '0x' + privateKey.substring(64, 128),
            from: from,
            nonce: nonce,
            gasLimit: TX_DEFAULT_GASLIMIT,
            gasPrice: this.convert10to16(gasPrice),
            to: to,
            data: data,
            value: this.convert10to16(value)
        };

        console.log("Transfer parameters：" + JSON.stringify(txParams));

        const tx = new CypheriumTx.Transaction(txParams, {
        });
        var p = new Uint8Array(this._hexStringToBytes(privateKey));
        var k = new Uint8Array(this._hexStringToBytes(privateKey.substring(64, 128)));
        tx.signWith25519(p, k);
        return tx;
    }

    async getTxDetail(tx) {
        let result = await this.web3c.cph.getTransaction(tx);
        result.value = this.web3c.fromWei(result.value, 'cpher');
        result.gasPrice = this.web3c.fromWei(result.gasPrice, 'cpher');
        return result
    }

    computeSha256Hash(str) {
        const sha256 = sha('sha256');
        const msgHash = sha256.update(str, 'utf8').digest('hex');
        return msgHash;
    }

    strToBase64(str) {
        let strBase64 = new Buffer(str, "hex").toString('base64');
        return strBase64;
    }

    base64ToStr(base64) {
        let str = new Buffer(base64, "base64").toString("hex");
        return str;
    }

    strToBuffer(str, type) {
        console.log(str + 'Is about to be turned into a Buffer object');
        if (type === 'hex') {
            return Buffer.from(str, 'hex');
        } else {
            return Buffer.from(str);
        }
    }

    floatMultiple(f1, f2) {
        let m1 = new this.web3c.BigNumber(f1),
            m2 = new this.web3c.BigNumber(f2);
        return m1.mul(m2);
    }

    bufferToStr(buf, type) {
        if (type) {
            return buf.toString(type);
        } else {
            return buf.toString();
        }
    }

    convert10to16(n) {
        if (typeof n !== 'string') {
            n = n.toString();
        }
        if (n.startsWith('0x')) {
            return n;
        }
        return this.web3c.toHex(n);
    }

    _hexStringToBytes(hexStr) {
        let result = [];
        while (hexStr.length >= 2) {
            result.push(parseInt(hexStr.substring(0, 2), 16));
            hexStr = hexStr.substring(2, hexStr.length);
        }
        return result;
    }

    _bytesToHexString(byteArray) {
        return Array.prototype.map.call(byteArray, function (byte) {
            return ('0' + (byte & 0xFF).toString(16)).slice(-2);
        }).join('');
    }

}





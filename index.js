#!/usr/bin/env node
const fs = require("fs")

const snakeCase = function(str) {
    return str.replace(/([A-Z]+)/g, "_$1").replace(/^_/,'').replace(/_+/g,'_').toLowerCase()
}

const camelize = function(str) {
    return str.replace(/(?:^\w|[A-Z]|\b\w|\s+)/g, function(match, index) {
        if (+match === 0) return "" // or if (/\s+/.test(match)) for white spaces
        return index == 0 ? match.toLowerCase() : match.toUpperCase()
    })
}

const getInputs = function(args) {
    return args
        .filter(a => a[0].indexOf("in") == 0 || a[0].indexOf("optIn") == 0)
        .map(a => [snakeCase(a[0].replace(/^(in|optIn)/, "")), a[1]])
}

const getInputTypes = function(args) {
    const typeMap = {
        f32: "TA_Real",
        f64: "TA_Real",
        "::std::os::raw::c_int": "i32",
        TA_MAType: "TA_MAType"
    }

    return args
        .map(a => {
            let [n, t] = a

            if (t.indexOf('*') == 0) {
                let innerType = typeMap[t.match(/([a-z][0-9][0-9])/)[1]]
                t = `&Vec<${innerType}>`
            } else {
                t = typeMap[t]
            }

            return [n, t]
        })
}

const getOutputs = function(args) {
    return args
        .filter(a => a[0].indexOf("out") == 0)
        // remove outs that are common to all functions
        .filter(a => ["outBegIdx", "outNBElement"].indexOf(a[0]) < 0)
        .map(a => [snakeCase(a[0]), a[1]])
}

const getOutputTypes = function(args) {
    const typeMap = {
        "::std::os::raw::c_int": "TA_Integer",
        f32: "TA_Real",
        f64: "TA_Real"
    }

    return args
        .map(a => {
            let [n, t] = a

            let innerType = typeMap[t.match(/\*[a-z]+\s+([\w:*0-9]+)/)[1]]
            t = `Vec<${innerType}>`

            return [n, t]
        })
}

const generateFnCode = function(fn) {
    let inputs = getInputs(fn.args)
    inputs = getInputTypes(inputs)
    let outputs = getOutputs(fn.args)
    outputs = getOutputTypes(outputs)

    const inputTypes = inputs
        .map(i => `${i[0]}: ${i[1]}`)
        .join(', ')
    const outputTypes = outputs
        .map(o => o[1])
        .join(', ')

    // We're under the assumptions that the only output declarations are Vecs
    // and that the first input is always a Vec from which we can derive the output's len
    const outputDeclarations = outputs
        .map(o => `let mut ${o[0]}: ${o[1]} = Vec::with_capacity(${inputs[0][0]}.len());`)
        .join('\n')
    const outputArgs = outputs
        .map(o => `${o[0]}.as_mut_ptr(),`)
        .join('\n            ')

    const inputArgs = inputs
        .map(i => {
            if (i[1].indexOf("Vec<") >= 0)
                return `${i[0]}.as_ptr(),`
            else
                return `${i[0]},`
        })
        .join('\n            ')


    const onSuccessSetSizes = outputs
        .map(o => `${o[0]}.set_len(out_size as usize);`)
        .join('\n')

    const returnOutputs = outputs
        .map(o => o[0])
        .join(', ')

    const maTypeInclude = fn.args.filter(a => a[1].indexOf('TA_MAType') >= 0).length ? "TA_MAType, " : ""

    return `
use ta_lib_wrapper::{TA_Integer, TA_Real, ${`TA_${fn.name}`}, ${maTypeInclude}TA_RetCode};

pub fn ${fn.name.toLowerCase()}(${inputTypes}) -> (${outputTypes}, TA_Integer) {
    ${outputDeclarations}
    let mut out_begin: TA_Integer = 0;
    let mut out_size: TA_Integer = 0;

    unsafe {
        let ret_code = TA_${fn.name}(
            0,                              // index of the first element to use
            ${inputs[0][0]}.len() as i32 - 1,          // index of the last element to use
            ${inputArgs}
            &mut out_begin,                 // set to index of the first close to have an rsi value
            &mut out_size,                  // set to number of sma values computed
            ${outputArgs}
        );
        match ret_code {
            // Indicator was computed correctly, since the vector was filled by TA-lib C library,
            // Rust doesn't know what is the new length of the vector, so we set it manually
            // to the number of values returned by the TA_CDLTRISTAR call
            TA_RetCode::TA_SUCCESS => {
                ${onSuccessSetSizes}
            },
            // An error occured
            _ => panic!("Could not compute indicator, err: {:?}", ret_code)
        }
    }

    (${returnOutputs}, out_begin)
}
    `
}


const argv = require('yargs')
    .usage('Usage: $0 --input [path] --output [path]')
    .alias('i', 'input')
    .alias('o', 'output')
    .demandOption(['i', 'o'])
    .argv

const text = fs.readFileSync(argv.i).toString('utf-8')

const fnsRegex = new RegExp(/pub fn TA_([A-Z]+)\((?:\w+\:.*\,?\s*)+\)/g)
const fnNameRegex = new RegExp(/pub fn TA_([A-Z]+)\(/)
const argsRegex = /(\w+)\: ([\w:*0-9 ]+)\,?/g
const argTypeRegex = /(\w+)\: ([\w:*0-9 ]+)\,?/

const fns = text.match(fnsRegex)
    .map(fn => {
        return {
            name: fn.match(fnNameRegex)[1],
            args: fn.match(argsRegex).map(arg => {
                const m = arg.match(argTypeRegex)
                return [m[1], m[2]]
            })
        }
    })

fns.forEach(fn => {
    let curr = fs.createWriteStream(`${argv.o}/${fn.name.toLowerCase()}.rs`)
    curr.once('open', function(fd) {
        curr.write(generateFnCode(fn))
        curr.end()
    })
})

let mod = fs.createWriteStream(`${argv.o}/mod.rs`)
mod.once('open', function(fd) {
    mod.write(fns.map(fn => `pub mod ${fn.name.toLowerCase()};`).join('\n'))
    mod.end()
})

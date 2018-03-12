const fs = require("fs")
const text = fs.readFileSync("./in/bindings.rs").toString('utf-8')

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

const camelize = function(str) {
    return str.replace(/(?:^\w|[A-Z]|\b\w|\s+)/g, function(match, index) {
        if (+match === 0) return "" // or if (/\s+/.test(match)) for white spaces
        return index == 0 ? match.toLowerCase() : match.toUpperCase()
    })
}

const getInTypes = function(args) {
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
                let innerType = typeMap[t.match(/([a-z][0-9]+)/)[1]]
                t = `&Vec<${innerType}>`
            } else {
                t = typeMap[t]
            }

            return [n, t]
        })
}

const getInputs = function(args) {
    return args
        .filter(a => a[0].indexOf("in") == 0 || a[0].indexOf("optIn") == 0)
        .map(a => [camelize(a[0].replace(/^(in|optIn)/, "")), a[1]])
}

const getOutputs = function(args) {
    return args
        .filter(a => a[0].indexOf("out") == 0)
}

const generateCode = function(fn) {
    let inputs = getInputs(fn.args)
    inputs = getInTypes(inputs)
    const output = getOutputs(fn.args)
    console.log(inputs)
    return `
use ta_lib_wrapper::{TA_Integer, TA_Real, TA_${fn.name},  TA_RetCode};


pub fn tristar(open: &Vec<TA_Real>, high: &Vec<TA_Real>, low: &Vec<TA_Real>, close: &Vec<TA_Real>) -> (Vec<TA_Integer>, TA_Integer) {
    let mut out: Vec<TA_Integer> = Vec::with_capacity(open.len());
    let mut out_begin: TA_Integer = 0;
    let mut out_size: TA_Integer = 0;

    unsafe {
        let ret_code = TA_CDLTRISTAR(
            0,                              // index of the first close to use
            open.len() as i32 - 1,          // index of the last close to use
            open.as_ptr(),                  // pointer to the first element of the vector
            high.as_ptr(),                  // pointer to the first element of the vector
            low.as_ptr(),                   // pointer to the first element of the vector
            close.as_ptr(),                 // pointer to the first element of the vector
            &mut out_begin,                 // set to index of the first close to have an rsi value
            &mut out_size,                  // set to number of sma values computed
            out.as_mut_ptr()                // pointer to the first element of the output vector
        );
        match ret_code {
            // Indicator was computed correctly, since the vector was filled by TA-lib C library,
            // Rust doesn't know what is the new length of the vector, so we set it manually
            // to the number of values returned by the TA_CDLTRISTAR call
            TA_RetCode::TA_SUCCESS => out.set_len(out_size as usize),
            // An error occured
            _ => panic!("Could not compute indicator, err: {:?}", ret_code)
        }
    }

    (out, out_begin)
}
    `
}


fns.map(f => generateCode(f))
// console.log(fns[0].args)

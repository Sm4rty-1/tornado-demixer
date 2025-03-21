So, here is the details, we are creating tornado cash demixing sofware. 

I pass in txn hash, number of deposit transactions with the same amount,block number to search up. 
It will fetch the data based on txn hash. 

now we have depositer address using txn hash, and we are fetching possible withdrawer addresses. 

next we have to fetch depositer other txns, and other txns of withdrawal and match pattern based on filters for depositer with each withdrawl addresses. for those who dont have any txns in withdrawl skip. 

now we have both of it. we neeed to apply various filters to get the final list of possible withdrawl address that may be the depositer. at each stage of filter console log possible withdrawl addresses. 

make it very better and well documented.. forget about const.js
modify the script and return me full utils, const, and main.js files. 

It should be very well structured. improve naming conventions, function names shouldn't be that long, etc. maintain uniformity across code. Dont' add comments.  and should look like professionals wrote it. if you have any doubt about code tell me. 
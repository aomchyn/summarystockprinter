const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const ImageModule = require('docxtemplater-image-module-free');
const fs = require('fs');

const content = fs.readFileSync('public/templates/cleaning_report.docx', 'binary');
const zip = new PizZip(content);

const imageOptions = {
    centered: false,
    getImage: function(tagValue, tagName) {
        console.log('getImage called with:', tagValue, tagName);
        return fs.readFileSync('public/templates/cleaning_report.docx'); // just return some buffer
    },
    getSize: function(img, tagValue, tagName) {
        return [150, 60];
    }
};

const imageModule = new ImageModule(imageOptions);
const doc = new Docxtemplater(zip, {
    modules: [imageModule],
    paragraphLoop: true,
    linebreaks: true,
});

doc.render({ "signature%": "test_tag_value" });
console.log('Render complete');

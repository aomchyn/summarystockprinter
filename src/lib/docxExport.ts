import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import ImageModule from 'docxtemplater-image-module-free';
import DocxMerger from 'docx-merger';

export const generateDocument = async (
  templateUrl: string,
  fileName: string,
  data: any
) => {
  try {
    // 1. Load the template
    const response = await fetch(templateUrl);
    const arrayBuffer = await response.arrayBuffer();

    // 2. Load the signature image if it exists in data
    let signatureArrayBuffer: ArrayBuffer | null = null;
    
    if (data.signature_url) {
      const sigResponse = await fetch(data.signature_url);
      signatureArrayBuffer = await sigResponse.arrayBuffer();
      // Set the tag value for docxtemplater so it knows to process {%signature} and {%signature%}
      data.signature = "true"; 
      data["signature%"] = "true"; 
    }

    // 3. Initialize PizZip and docxtemplater
    const zip = new PizZip(arrayBuffer);

    const imageOptions = {
      centered: false,
      getImage: (tagValue: string, tagName: string) => {
        if ((tagName === 'signature' || tagName === 'signature%') && signatureArrayBuffer) {
          return signatureArrayBuffer;
        }
        return new ArrayBuffer(0); // Return empty if anything else
      },
      getSize: (img: any, tagValue: string, tagName: string) => {
        if (tagName === 'signature' || tagName === 'signature%') {
          return [100, 40]; // ขนาดลายเซ็นที่เล็กลง (กว้าง 100px, สูง 40px) เพื่อไม่ให้ล้นช่อง
        }
        return [100, 100];
      },
      getMimeType: () => 'image/png' // Force image/png
    };

    const imageModule = new ImageModule(imageOptions);

    const doc = new Docxtemplater(zip, {
      modules: [imageModule],
      paragraphLoop: true,
      linebreaks: true,
    });

    // 4. Set data and render
    doc.render(data);

    // 5. Generate and download
    const out = doc.getZip().generate({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    // Simple download trigger
    const url = URL.createObjectURL(out);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
  } catch (error) {
    console.error('Error generating document:', error);
    throw error;
  }
};

export const generateMultipleDocumentsAsZip = async (
  templateUrl: string,
  outFileName: string,
  records: { fileName: string; data: any }[]
) => {
  try {
    // 1. Load the template
    const response = await fetch(templateUrl);
    const arrayBuffer = await response.arrayBuffer();

    // 2. Load the signature image from the first record if exists
    let signatureArrayBuffer: ArrayBuffer | null = null;
    const firstData = records[0]?.data;
    
    if (firstData && firstData.signature_url) {
      const sigResponse = await fetch(firstData.signature_url);
      signatureArrayBuffer = await sigResponse.arrayBuffer();
    }

    // Array to hold generated document buffers
    const generatedDocs: ArrayBuffer[] = [];

    // Generate each document
    for (const record of records) {
      const data = record.data;
      if (signatureArrayBuffer) {
        data.signature = "true";
        data["signature%"] = "true";
      }

      const docZip = new PizZip(arrayBuffer);
      const imageOptions = {
        centered: false,
        getImage: (tagValue: string, tagName: string) => {
          if ((tagName === 'signature' || tagName === 'signature%') && signatureArrayBuffer) {
            return signatureArrayBuffer;
          }
          return new ArrayBuffer(0);
        },
        getSize: (img: any, tagValue: string, tagName: string) => {
          if (tagName === 'signature' || tagName === 'signature%') {
            return [100, 40];
          }
          return [100, 100];
        },
        getMimeType: () => 'image/png'
      };

      const imageModule = new ImageModule(imageOptions);
      const doc = new Docxtemplater(docZip, {
        modules: [imageModule],
        paragraphLoop: true,
        linebreaks: true,
      });

      doc.render(data);

      const docContent = doc.getZip().generate({
        type: 'arraybuffer'
      });

      generatedDocs.push(docContent as ArrayBuffer);
    }

    // Merge documents
    const merger = new DocxMerger({}, generatedDocs);
    merger.save('blob', function(data: Blob) {
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = outFileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
    
  } catch (error) {
    console.error('Error generating merged document:', error);
    throw error;
  }
};

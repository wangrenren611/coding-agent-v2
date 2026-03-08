import  {v4 as uuidv4} from 'uuid';

export const getMessageId=()=>{
    return uuidv4();
}
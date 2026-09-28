/** Eval-only ownership barrier. Aborting is not equivalent to observing that
 * every issued request settled. A timeout remains explicit missing coverage. */
export class ProbeRequestDrain {
  private pending=new Set<Promise<void>>();
  get size(){return this.pending.size;}
  begin():()=>void {
    let finish!:()=>void;
    const settled=new Promise<void>(resolve=>{finish=resolve;});this.pending.add(settled);
    return ()=>{this.pending.delete(settled);finish();};
  }
  async drain(deadlineMs:number):Promise<boolean> {
    if(!Number.isSafeInteger(deadlineMs) || deadlineMs<1 || deadlineMs>10000)throw Error("Bounded probe drain deadline required");
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      return await Promise.race([Promise.all([...this.pending]).then(()=>this.pending.size===0),
        new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),deadlineMs);})]);
    }finally{if(timer)clearTimeout(timer);}
  }
}
